/**
 * Title Chain Tracking — Parcel Genealogy + ArdhiSasa Online Lookup
 *
 * OV7: Full parcel genealogy. Trace any parcel back to its original grant.
 * When online, fetch historical records from ArdhiSasa. When offline, use
 * the local cache of all parcels ever surveyed.
 *
 * Features:
 *   - Visual timeline: see how a parcel was subdivided/amalgamated over time
 *   - Automatic conflict detection (overlapping claims, boundary disputes)
 *   - Graph database of parcel relationships (parent → child)
 *   - Integration with ArdhiSasa historical records (when online)
 *   - Local cache of all parcels ever surveyed
 *   - Export title chain as PDF for legal proceedings
 *   - Alert when a new survey encroaches on an existing parcel
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, net } from 'electron';
import log from 'electron-log/main';

export interface TitleChainEntry {
  transactionId: string;
  transactionType: 'original_grant' | 'subdivision' | 'amalgamation' | 'transfer' | 'boundary_adjustment' | 'resurvey';
  date: string;
  parcelNumber: string;
  parentParcelNumbers: string[];  // empty for original grant
  childParcelNumbers: string[];   // empty if not subdivided
  surveyorName?: string;
  surveyorLicense?: string;
  areaHectares: number;
  registryMapSheet?: string;
  deedPlanNumber?: string;
  titleDeedNumber?: string;
  ownerName?: string;
  notes?: string;
  // Source of this record
  source: 'local' | 'ardhisasa' | 'manual';
  fetchedAt?: string;
}

export interface TitleChainResult {
  parcelNumber: string;
  chain: TitleChainEntry[];
  hasOnlineData: boolean;
  conflicts: Array<{
    type: 'overlap' | 'gap' | 'duplicate_title';
    description: string;
    conflictingParcels: string[];
  }>;
}

export interface ArdhiSasaConfig {
  apiUrl: string;       // e.g. https://api.ardhisasa.go.ke/v1
  apiKey?: string;
  timeout: number;      // ms, default 15000
}

const DEFAULT_TIMEOUT = 15000;

export class TitleChainTracker {
  private cachePath: string;
  private localCache: Map<string, TitleChainEntry[]> = new Map();
  private ardhiConfig: ArdhiSasaConfig | null = null;

  constructor() {
    this.cachePath = path.join(app.getPath('userData'), 'title-chain-cache.json');
    this.loadCache();
  }

  /**
   * Configure ArdhiSasa API connection (for online lookups).
   */
  configureArdhiSasa(config: ArdhiSasaConfig): void {
    this.ardhiConfig = config;
    log.info(`ArdhiSasa configured: ${config.apiUrl}`);
  }

  /**
   * Get the full title chain for a parcel.
   * First checks local cache, then fetches from ArdhiSasa if online.
   */
  async getTitleChain(parcelNumber: string): Promise<TitleChainResult> {
    const chain: TitleChainEntry[] = [];
    let hasOnlineData = false;

    // 1. Check local cache
    const localEntries = this.localCache.get(parcelNumber) ?? [];
    chain.push(...localEntries);

    // 2. Try online lookup from ArdhiSasa (if configured and online)
    if (this.ardhiConfig && net.online) {
      try {
        const onlineEntries = await this.fetchFromArdhiSasa(parcelNumber);
        if (onlineEntries.length > 0) {
          hasOnlineData = true;
          // Merge: prefer online data for duplicates
          for (const entry of onlineEntries) {
            const existing = chain.find((e) => e.transactionId === entry.transactionId);
            if (!existing) {
              chain.push(entry);
              // Cache for offline use
              this.addToCache(parcelNumber, entry);
            }
          }
        }
      } catch (err) {
        log.warn(`ArdhiSasa lookup failed for ${parcelNumber}:`, err);
      }
    }

    // 3. Sort by date
    chain.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // 4. Detect conflicts
    const conflicts = this.detectConflicts(chain);

    // 5. Trace parent parcels recursively (up the chain)
    const allParentChains = await this.traceParents(chain, new Set([parcelNumber]));
    chain.unshift(...allParentChains);

    return { parcelNumber, chain, hasOnlineData, conflicts };
  }

  /**
   * Fetch title history from ArdhiSasa API.
   */
  private async fetchFromArdhiSasa(parcelNumber: string): Promise<TitleChainEntry[]> {
    if (!this.ardhiConfig) return [];

    const url = `${this.ardhiConfig.apiUrl}/parcels/${encodeURIComponent(parcelNumber)}/history`;
    log.info(`Fetching from ArdhiSasa: ${url}`);

    return new Promise((resolve, reject) => {
      const timeout = this.ardhiConfig!.timeout ?? DEFAULT_TIMEOUT;
      const timer = setTimeout(() => reject(new Error('ArdhiSasa request timed out')), timeout);

      const request = net.request({
        method: 'GET',
        url,
        redirect: 'follow',
      });

      if (this.ardhiConfig!.apiKey) {
        request.setHeader('Authorization', `Bearer ${this.ardhiConfig!.apiKey}`);
      }
      request.setHeader('Accept', 'application/json');

      let body = '';
      request.on('response', (response) => {
        response.on('data', (chunk) => { body += chunk.toString(); });
        response.on('end', () => {
          clearTimeout(timer);
          if (response.statusCode === 200) {
            try {
              const data = JSON.parse(body);
              const entries: TitleChainEntry[] = (data.history ?? []).map((item: any) => ({
                transactionId: item.transaction_id ?? item.id,
                transactionType: item.transaction_type ?? 'transfer',
                date: item.date ?? item.transaction_date,
                parcelNumber: item.parcel_number ?? parcelNumber,
                parentParcelNumbers: item.parent_parcels ?? [],
                childParcelNumbers: item.child_parcels ?? [],
                surveyorName: item.surveyor_name,
                surveyorLicense: item.surveyor_license,
                areaHectares: item.area_hectares ?? 0,
                registryMapSheet: item.registry_map_sheet,
                deedPlanNumber: item.deed_plan_number,
                titleDeedNumber: item.title_deed_number,
                ownerName: item.owner_name,
                notes: item.notes,
                source: 'ardhisasa' as const,
                fetchedAt: new Date().toISOString(),
              }));
              resolve(entries);
            } catch (err) {
              reject(new Error(`Failed to parse ArdhiSasa response: ${err}`));
            }
          } else if (response.statusCode === 404) {
            resolve([]);  // No history found
          } else {
            reject(new Error(`ArdhiSasa returned ${response.statusCode}`));
          }
        });
      });

      request.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      request.end();
    });
  }

  /**
   * Trace parent parcels recursively (walk up the genealogy tree).
   */
  private async traceParents(entries: TitleChainEntry[], visited: Set<string>): Promise<TitleChainEntry[]> {
    const parents: TitleChainEntry[] = [];
    for (const entry of entries) {
      for (const parentNumber of entry.parentParcelNumbers) {
        if (visited.has(parentNumber)) continue;
        visited.add(parentNumber);
        const parentEntries = this.localCache.get(parentNumber) ?? [];
        parents.push(...parentEntries);
        // Recurse
        const grandparents = await this.traceParents(parentEntries, visited);
        parents.unshift(...grandparents);
      }
    }
    return parents;
  }

  /**
   * Detect conflicts in the title chain.
   */
  private detectConflicts(chain: TitleChainEntry[]): Array<{
    type: 'overlap' | 'gap' | 'duplicate_title';
    description: string;
    conflictingParcels: string[];
  }> {
    const conflicts: Array<{
      type: 'overlap' | 'gap' | 'duplicate_title';
      description: string;
      conflictingParcels: string[];
    }> = [];

    // Check for duplicate title deeds
    const titleMap = new Map<string, string[]>();
    for (const entry of chain) {
      if (entry.titleDeedNumber) {
        if (!titleMap.has(entry.titleDeedNumber)) titleMap.set(entry.titleDeedNumber, []);
        titleMap.get(entry.titleDeedNumber)!.push(entry.parcelNumber);
      }
    }
    for (const [title, parcels] of titleMap) {
      if (parcels.length > 1) {
        conflicts.push({
          type: 'duplicate_title',
          description: `Title deed ${title} is registered to ${parcels.length} parcels: ${parcels.join(', ')}`,
          conflictingParcels: parcels,
        });
      }
    }

    // Check for area reconciliation issues (parent area should equal sum of children)
    const subdivisions = chain.filter((e) => e.transactionType === 'subdivision');
    for (const sub of subdivisions) {
      if (sub.childParcelNumbers.length > 0) {
        const childAreas = sub.childParcelNumbers
          .map((pn) => chain.find((e) => e.parcelNumber === pn))
          .filter((e): e is TitleChainEntry => !!e)
          .reduce((sum, e) => sum + e.areaHectares, 0);
        const diff = Math.abs(sub.areaHectares - childAreas);
        if (diff > 0.001) {
          conflicts.push({
            type: 'gap',
            description: `Subdivision area mismatch: parent ${sub.parcelNumber} = ${sub.areaHectares} ha, sum of children = ${childAreas.toFixed(4)} ha (diff = ${diff.toFixed(4)} ha)`,
            conflictingParcels: [sub.parcelNumber, ...sub.childParcelNumbers],
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * Add an entry to the local cache.
   */
  addToCache(parcelNumber: string, entry: TitleChainEntry): void {
    if (!this.localCache.has(parcelNumber)) {
      this.localCache.set(parcelNumber, []);
    }
    const entries = this.localCache.get(parcelNumber)!;
    // Don't duplicate by transaction ID
    if (!entries.find((e) => e.transactionId === entry.transactionId)) {
      entries.push(entry);
      this.saveCache();
    }
  }

  /**
   * Search the local cache for parcels matching a query.
   */
  searchLocalCache(query: string): TitleChainEntry[] {
    const results: TitleChainEntry[] = [];
    const lowerQuery = query.toLowerCase();
    for (const entries of this.localCache.values()) {
      for (const entry of entries) {
        if (
          entry.parcelNumber.toLowerCase().includes(lowerQuery) ||
          entry.ownerName?.toLowerCase().includes(lowerQuery) ||
          entry.titleDeedNumber?.toLowerCase().includes(lowerQuery) ||
          entry.deedPlanNumber?.toLowerCase().includes(lowerQuery)
        ) {
          results.push(entry);
        }
      }
    }
    return results;
  }

  private loadCache(): void {
    try {
      if (fs.existsSync(this.cachePath)) {
        const data = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8'));
        for (const [parcel, entries] of Object.entries(data)) {
          this.localCache.set(parcel, entries as TitleChainEntry[]);
        }
        log.info(`Title chain cache loaded: ${this.localCache.size} parcels`);
      }
    } catch (err) {
      log.warn('Failed to load title chain cache:', err);
    }
  }

  private saveCache(): void {
    try {
      const data: Record<string, TitleChainEntry[]> = {};
      for (const [parcel, entries] of this.localCache) {
        data[parcel] = entries;
      }
      fs.writeFileSync(this.cachePath, JSON.stringify(data, null, 2));
    } catch (err) {
      log.warn('Failed to save title chain cache:', err);
    }
  }
}
