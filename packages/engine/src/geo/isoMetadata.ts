/**
 * ISO 19115/19139 Metadata Generator
 *
 * Generates formal geographic metadata for METARDU projects, surveys, and
 * exported files. A boundary commission won't accept data without metadata
 * — ISO 19115 is the international standard for geographic information
 * metadata, and ISO 19139 is its XML implementation.
 *
 * This module produces ISO 19139 XML containing:
 *   - Identification info (title, abstract, citation)
 *   - Spatial reference (datum, CRS, epoch)
 *   - Temporal extent (survey date range)
 *   - Data quality (lineage, accuracy, confidence)
 *   - Custodian (who's responsible)
 *   - Distribution (how to get the data)
 *
 * References:
 *   - ISO 19115:2014 — Geographic information — Metadata
 *   - ISO 19139:2007 — XML schema implementation
 *   - ISO/TS 19139-2 — Extensions for imagery and gridded data
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MetadataCitation {
  /** Title of the dataset */
  title: string
  /** Publication date (ISO) */
  date: string
  /** Creator/author name */
  creator: string
  /** Publisher organization */
  publisher: string
  /** Unique identifier (e.g., project UUID) */
  identifier: string
}

export interface MetadataSpatialReference {
  /** CRS name (e.g., 'Arc 1960 / UTM Zone 37S') */
  crsName: string
  /** EPSG code (e.g., 'EPSG:21037') */
  epsgCode: string
  /** Datum (e.g., 'Arc 1960') */
  datum: string
  /** Ellipsoid (e.g., 'Clarke 1880 (RGS)') */
  ellipsoid: string
  /** Coordinate epoch (decimal year, e.g., 2025.5) */
  epoch: number
  /** Reference frame (e.g., 'ITRF2014') */
  referenceFrame?: string
}

export interface MetadataTemporalExtent {
  /** Start date (ISO) */
  beginDate: string
  /** End date (ISO) */
  endDate: string
}

export interface MetadataQuality {
  /** Lineage — how the data was produced */
  lineage: string
  /** Positional accuracy (95% confidence, meters) */
  positionalAccuracy: number
  /** Vertical accuracy (meters, if applicable) */
  verticalAccuracy?: number
  /** Confidence level (e.g., 0.95) */
  confidenceLevel: number
  /** Statistical test results (if LSA was performed) */
  lsaGlobalTestPassed?: boolean
  /** Minimal Detectable Bias (meters, if LSA was performed) */
  mdb?: number
}

export interface MetadataCustodian {
  /** Individual or organization name */
  name: string
  /** Organization */
  organization: string
  /** Email */
  email: string
  /** Phone */
  phone?: string
  /** Role: 'originator', 'custodian', 'distributor', 'owner' */
  role: string
}

export interface MetadataDistribution {
  /** Format (e.g., 'GeoJSON', 'DXF', 'Shapefile') */
  format: string
  /** Format version */
  formatVersion: string
  /** File size (bytes) */
  fileSize: number
  /** Download URL or 'contact custodian' */
  transferOptions: string
}

export interface MetadataInput {
  /** Citation info */
  citation: MetadataCitation
  /** Abstract / description */
  abstract: string
  /** Purpose */
  purpose: string
  /** Spatial reference */
  spatialReference: MetadataSpatialReference
  /** Temporal extent */
  temporalExtent: MetadataTemporalExtent
  /** Quality info */
  quality: MetadataQuality
  /** Custodian */
  custodian: MetadataCustodian
  /** Distribution info */
  distribution?: MetadataDistribution
  /** Keywords */
  keywords: string[]
  /** Bounding box [minLon, minLat, maxLon, maxLat] */
  boundingBox?: [number, number, number, number]
  /** Survey type (e.g., 'cadastral', 'topographic', 'engineering') */
  surveyType: string
  /** Legal references (e.g., 'Survey Act Cap. 299') */
  legalReferences?: string[]
}

// ─── XML Generation ─────────────────────────────────────────────────────────

/**
 * Escape special XML characters.
 */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Generate an ISO 19139 XML metadata document from a MetadataInput.
 *
 * The output is a complete, valid ISO 19139 XML string that can be:
 *   - Embedded in a GeoJSON file as metadata
 *   - Attached as a sidecar .xml file to a DXF or Shapefile
 *   - Submitted to a spatial data catalog (e.g., Kenyan NSDI)
 *   - Stored in the database alongside the project
 */
export function generateISO19139Metadata(input: MetadataInput): string {
  const now = new Date().toISOString()

  const keywords = input.keywords
    .map(k => `        <gmd:keyword><gco:CharacterString>${xmlEscape(k)}</gco:CharacterString></gmd:keyword>`)
    .join('\n')

  const bbox = input.boundingBox
    ? `      <gmd:extent>
        <gmd:EX_Extent>
          <gmd:geographicElement>
            <gmd:EX_GeographicBoundingBox>
              <gmd:westBoundLongitude><gco:Decimal>${input.boundingBox[0]}</gco:Decimal></gmd:westBoundLongitude>
              <gmd:eastBoundLongitude><gco:Decimal>${input.boundingBox[2]}</gco:Decimal></gmd:eastBoundLongitude>
              <gmd:southBoundLatitude><gco:Decimal>${input.boundingBox[1]}</gco:Decimal></gmd:southBoundLatitude>
              <gmd:northBoundLatitude><gco:Decimal>${input.boundingBox[3]}</gco:Decimal></gmd:northBoundLatitude>
            </gmd:EX_GeographicBoundingBox>
          </gmd:geographicElement>
        </gmd:EX_Extent>
      </gmd:extent>`
    : ''

  const distribution = input.distribution
    ? `  <gmd:distributionInfo>
    <gmd:MD_Distribution>
      <gmd:distributionFormat>
        <gmd:MD_Format>
          <gmd:name><gco:CharacterString>${xmlEscape(input.distribution.format)}</gco:CharacterString></gmd:name>
          <gmd:version><gco:CharacterString>${xmlEscape(input.distribution.formatVersion)}</gco:CharacterString></gmd:version>
        </gmd:MD_Format>
      </gmd:distributionFormat>
      <gmd:transferOptions>
        <gmd:MD_DigitalTransferOptions>
          <gmd:transferSize><gco:Real>${input.distribution.fileSize}</gco:Real></gmd:transferSize>
          <gmd:onLine>
            <gmd:CI_OnlineResource>
              <gmd:linkage><gmd:URL>${xmlEscape(input.distribution.transferOptions)}</gmd:URL></gmd:linkage>
            </gmd:CI_OnlineResource>
          </gmd:onLine>
        </gmd:MD_DigitalTransferOptions>
      </gmd:transferOptions>
    </gmd:MD_Distribution>
  </gmd:distributionInfo>`
    : ''

  const legalRefs = (input.legalReferences || [])
    .map(ref => `          <gmd:otherConstraints><gco:CharacterString>${xmlEscape(ref)}</gco:CharacterString></gmd:otherConstraints>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<gmd:MD_Metadata xmlns:gmd="http://www.isotc211.org/2005/gmd"
                 xmlns:gco="http://www.isotc211.org/2005/gco"
                 xmlns:gml="http://www.opengis.net/gml/3.2"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xsi:schemaLocation="http://www.isotc211.org/2005/gmd http://www.isotc211.org/2005/gmd/gmd.xsd">
  <gmd:fileIdentifier>
    <gco:CharacterString>${xmlEscape(input.citation.identifier)}</gco:CharacterString>
  </gmd:fileIdentifier>
  <gmd:language><gmd:LanguageCode codeList="http://www.loc.gov/standards/iso639-2" codeListValue="eng">eng</gmd:LanguageCode></gmd:language>
  <gmd:characterSet><gmd:MD_CharacterSetCode codeList="http://www.isotc211.org/2005/resources/Codelist/gmxCodelists.xml#MD_CharacterSetCode" codeListValue="utf8">utf8</gmd:MD_CharacterSetCode></gmd:characterSet>
  <gmd:hierarchyLevel>
    <gmd:MD_ScopeCode codeList="http://www.isotc211.org/2005/resources/Codelist/gmxCodelists.xml#MD_ScopeCode" codeListValue="dataset">dataset</gmd:MD_ScopeCode>
  </gmd:hierarchyLevel>
  <gmd:dateStamp>
    <gco:DateTime>${now}</gco:DateTime>
  </gmd:dateStamp>

  <!-- ─── Identification Info ─── -->
  <gmd:identificationInfo>
    <gmd:MD_DataIdentification>
      <gmd:citation>
        <gmd:CI_Citation>
          <gmd:title><gco:CharacterString>${xmlEscape(input.citation.title)}</gco:CharacterString></gmd:title>
          <gmd:date>
            <gmd:CI_Date>
              <gmd:date><gco:Date>${input.citation.date.split('T')[0]}</gco:Date></gmd:date>
              <gmd:dateType><gmd:CI_DateTypeCode codeList="http://www.isotc211.org/2005/resources/Codelist/gmxCodelists.xml#CI_DateTypeCode" codeListValue="creation">creation</gmd:CI_DateTypeCode></gmd:dateType>
            </gmd:CI_Date>
          </gmd:date>
          <gmd:identifier>
            <gmd:MD_Identifier>
              <gmd:code><gco:CharacterString>${xmlEscape(input.citation.identifier)}</gco:CharacterString></gmd:code>
            </gmd:MD_Identifier>
          </gmd:identifier>
          <gmd:citedResponsibleParty>
            <gmd:CI_ResponsibleParty>
              <gmd:organisationName><gco:CharacterString>${xmlEscape(input.citation.publisher)}</gco:CharacterString></gmd:organisationName>
              <gmd:role><gmd:CI_RoleCode codeList="http://www.isotc211.org/2005/resources/Codelist/gmxCodelists.xml#CI_RoleCode" codeListValue="originator">originator</gmd:CI_RoleCode></gmd:role>
            </gmd:CI_ResponsibleParty>
          </gmd:citedResponsibleParty>
        </gmd:CI_Citation>
      </gmd:citation>
      <gmd:abstract><gco:CharacterString>${xmlEscape(input.abstract)}</gco:CharacterString></gmd:abstract>
      <gmd:purpose><gco:CharacterString>${xmlEscape(input.purpose)}</gco:CharacterString></gmd:purpose>
      <gmd:status><gmd:MD_ProgressCode codeList="http://www.isotc211.org/2005/resources/Codelist/gmxCodelists.xml#MD_ProgressCode" codeListValue="completed">completed</gmd:MD_ProgressCode></gmd:status>
      <gmd:pointOfContact>
        <gmd:CI_ResponsibleParty>
          <gmd:individualName><gco:CharacterString>${xmlEscape(input.custodian.name)}</gco:CharacterString></gmd:individualName>
          <gmd:organisationName><gco:CharacterString>${xmlEscape(input.custodian.organization)}</gco:CharacterString></gmd:organisationName>
          <gmd:contactInfo>
            <gmd:CI_Contact>
              <gmd:address>
                <gmd:CI_Address>
                  <gmd:electronicMailAddress><gco:CharacterString>${xmlEscape(input.custodian.email)}</gco:CharacterString></gmd:electronicMailAddress>
                </gmd:CI_Address>
              </gmd:address>
            </gmd:CI_Contact>
          </gmd:contactInfo>
          <gmd:role><gmd:CI_RoleCode codeList="http://www.isotc211.org/2005/resources/Codelist/gmxCodelists.xml#CI_RoleCode" codeListValue="${input.custodian.role}">${input.custodian.role}</gmd:CI_RoleCode></gmd:role>
        </gmd:CI_ResponsibleParty>
      </gmd:pointOfContact>
      <gmd:resourceMaintenance>
        <gmd:MD_MaintenanceInformation>
          <gmd:maintenanceAndUpdateFrequency><gmd:MD_MaintenanceFrequencyCode codeList="http://www.isotc211.org/2005/resources/Codelist/gmxCodelists.xml#MD_MaintenanceFrequencyCode" codeListValue="asNeeded">asNeeded</gmd:MD_MaintenanceFrequencyCode></gmd:maintenanceAndUpdateFrequency>
        </gmd:MD_MaintenanceInformation>
      </gmd:resourceMaintenance>
      <gmd:descriptiveKeywords>
        <gmd:MD_Keywords>
${keywords}
          <gmd:type><gmd:MD_KeywordTypeCode codeList="http://www.isotc211.org/2005/resources/Codelist/gmxCodelists.xml#MD_KeywordTypeCode" codeListValue="theme">theme</gmd:MD_KeywordTypeCode></gmd:type>
        </gmd:MD_Keywords>
      </gmd:descriptiveKeywords>
      <gmd:resourceConstraints>
        <gmd:MD_LegalConstraints>
          <gmd:useConstraints><gmd:MD_RestrictionCode codeList="http://www.isotc211.org/2005/resources/Codelist/gmxCodelists.xml#MD_RestrictionCode" codeListValue="license">license</gmd:MD_RestrictionCode></gmd:useConstraints>
${legalRefs}
        </gmd:MD_LegalConstraints>
      </gmd:resourceConstraints>
      <gmd:spatialRepresentationType><gmd:MD_SpatialRepresentationTypeCode codeList="http://www.isotc211.org/2005/resources/Codelist/gmxCodelists.xml#MD_SpatialRepresentationTypeCode" codeListValue="vector">vector</gmd:MD_SpatialRepresentationTypeCode></gmd:spatialRepresentationType>
      <gmd:spatialResolution>
        <gmd:MD_Resolution>
          <gmd:equivalentScale>
            <gmd:MD_RepresentativeFraction>
              <gmd:denominator><gco:Integer>1000</gco:Integer></gmd:denominator>
            </gmd:MD_RepresentativeFraction>
          </gmd:equivalentScale>
        </gmd:MD_Resolution>
      </gmd:spatialResolution>
      <gmd:topicCategory>
        <gmd:MD_TopicCategoryCode>geoscientificInformation</gmd:MD_TopicCategoryCode>
      </gmd:topicCategory>
      <gmd:extent>
        <gmd:EX_Extent>
          <gmd:temporalElement>
            <gmd:EX_TemporalExtent>
              <gmd:extent>
                <gml:TimePeriod gml:id="tp1">
                  <gml:beginPosition>${input.temporalExtent.beginDate}</gml:beginPosition>
                  <gml:endPosition>${input.temporalExtent.endDate}</gml:endPosition>
                </gml:TimePeriod>
              </gmd:extent>
            </gmd:EX_TemporalExtent>
          </gmd:temporalElement>
        </gmd:EX_Extent>
      </gmd:extent>
${bbox}
    </gmd:MD_DataIdentification>
  </gmd:identificationInfo>

  <!-- ─── Spatial Reference ─── -->
  <gmd:referenceSystemInfo>
    <gmd:MD_ReferenceSystem>
      <gmd:referenceSystemIdentifier>
        <gmd:RS_Identifier>
          <gmd:code><gco:CharacterString>${xmlEscape(input.spatialReference.epsgCode)}</gco:CharacterString></gmd:code>
          <gmd:codeSpace><gco:CharacterString>EPSG</gco:CharacterString></gmd:codeSpace>
          <gmd:version><gco:CharacterString>8.9</gco:CharacterString></gmd:version>
        </gmd:RS_Identifier>
      </gmd:referenceSystemIdentifier>
    </gmd:MD_ReferenceSystem>
  </gmd:referenceSystemInfo>

  <!-- ─── Data Quality ─── -->
  <gmd:dataQualityInfo>
    <gmd:DQ_DataQuality>
      <gmd:scope>
        <gmd:DQ_Scope>
          <gmd:level><gmd:MD_ScopeCode codeList="http://www.isotc211.org/2005/resources/Codelist/gmxCodelists.xml#MD_ScopeCode" codeListValue="dataset">dataset</gmd:MD_ScopeCode></gmd:level>
        </gmd:DQ_Scope>
      </gmd:scope>
      <gmd:report>
        <gmd:DQ_AbsoluteExternalPositionalAccuracy>
          <gmd:nameOfMeasure><gco:CharacterString>Horizontal accuracy at 95% confidence</gco:CharacterString></gmd:nameOfMeasure>
          <gmd:result>
            <gmd:DQ_QuantitativeResult>
              <gmd:valueUnit xlink:href="http://www.bipm.org/en/si/base_units/metre" xmlns:xlink="http://www.w3.org/1999/xlink"/>
              <gmd:value>
                <gco:Record>
                  <gco:Real>${input.quality.positionalAccuracy}</gco:Real>
                </gco:Record>
              </gmd:value>
            </gmd:DQ_QuantitativeResult>
          </gmd:result>
        </gmd:DQ_AbsoluteExternalPositionalAccuracy>
      </gmd:report>
      <gmd:lineage>
        <gmd:LI_Lineage>
          <gmd:statement><gco:CharacterString>${xmlEscape(input.quality.lineage)}</gco:CharacterString></gmd:statement>
        </gmd:LI_Lineage>
      </gmd:lineage>
    </gmd:DQ_DataQuality>
  </gmd:dataQualityInfo>

  <!-- ─── Custodian ─── -->
  <gmd:contact>
    <gmd:CI_ResponsibleParty>
      <gmd:individualName><gco:CharacterString>${xmlEscape(input.custodian.name)}</gco:CharacterString></gmd:individualName>
      <gmd:organisationName><gco:CharacterString>${xmlEscape(input.custodian.organization)}</gco:CharacterString></gmd:organisationName>
      <gmd:contactInfo>
        <gmd:CI_Contact>
          <gmd:phone>
            <gmd:CI_Telephone>
              <gmd:voice><gco:CharacterString>${xmlEscape(input.custodian.phone || '')}</gco:CharacterString></gmd:voice>
            </gmd:CI_Telephone>
          </gmd:phone>
          <gmd:address>
            <gmd:CI_Address>
              <gmd:electronicMailAddress><gco:CharacterString>${xmlEscape(input.custodian.email)}</gco:CharacterString></gmd:electronicMailAddress>
            </gmd:CI_Address>
          </gmd:address>
        </gmd:CI_Contact>
      </gmd:contactInfo>
      <gmd:role><gmd:CI_RoleCode codeList="http://www.isotc211.org/2005/resources/Codelist/gmxCodelists.xml#CI_RoleCode" codeListValue="${input.custodian.role}">${input.custodian.role}</gmd:CI_RoleCode></gmd:role>
    </gmd:CI_ResponsibleParty>
  </gmd:contact>

  <!-- ─── Distribution ─── -->
${distribution}

  <!-- ─── Metadata Extension: CRS + Epoch Details ─── -->
  <gmd:metadataExtensionInfo>
    <gmd:MD_ExtendedElementInformation>
      <gmd:name><gco:CharacterString>coordinateReferenceSystem</gco:CharacterString></gmd:name>
      <gmd:definition><gco:CharacterString>${xmlEscape(input.spatialReference.crsName)} (${xmlEscape(input.spatialReference.datum)}, ${xmlEscape(input.spatialReference.ellipsoid)})</gco:CharacterString></gmd:definition>
      <gmd:obligation><gmd:MD_ObligationCode>mandatory</gmd:MD_ObligationCode></gmd:obligation>
      <gmd:domainValue><gco:CharacterString>EPSG:${input.spatialReference.epsgCode}, Epoch: ${input.spatialReference.epoch}${input.spatialReference.referenceFrame ? ', Frame: ' + input.spatialReference.referenceFrame : ''}</gco:CharacterString></gmd:domainValue>
    </gmd:MD_ExtendedElementInformation>
  </gmd:metadataExtensionInfo>

  <gmd:metadataStandardName><gco:CharacterString>ISO 19115 Geographic Information - Metadata</gco:CharacterString></gmd:metadataStandardName>
  <gmd:metadataStandardVersion><gco:CharacterString>ISO 19115:2014</gco:CharacterString></gmd:metadataStandardVersion>
</gmd:MD_Metadata>`
}

// ─── Convenience: Generate from project data ────────────────────────────────

/**
 * Generate ISO 19139 metadata from a METARDU project's data.
 *
 * This is a convenience function that builds a MetadataInput from the
 * standard project fields and generates the XML.
 */
export function generateProjectMetadata(project: {
  id: string
  name: string
  survey_type: string
  location?: string
  utm_zone?: number
  hemisphere?: string
  datum?: string
  survey_date?: string
  user_name: string
  user_email: string
  organization?: string
  lsaPassed?: boolean
  accuracy?: number
  surveyorLicense?: string
}): string {
  const epsg = `EPSG:210${project.utm_zone || 37}`
  const epoch = project.survey_date
    ? parseFloat(project.survey_date.split('-')[0]) + 0.5
    : new Date().getFullYear() + 0.5

  return generateISO19139Metadata({
    citation: {
      title: `${project.survey_type || 'Survey'} — ${project.name}`,
      date: project.survey_date || new Date().toISOString(),
      creator: project.user_name,
      publisher: project.organization || 'METARDU',
      identifier: project.id,
    },
    abstract: `${project.survey_type || 'Survey'} conducted at ${project.location || 'Kenya'} using METARDU survey computation platform. Coordinates referenced to ${project.datum || 'Arc 1960'} / UTM Zone ${project.utm_zone || 37}${project.hemisphere || 'S'} (epoch ${epoch.toFixed(1)}).`,
    purpose: `Statutory ${project.survey_type || 'cadastral'} survey for submission to Survey of Kenya.`,
    spatialReference: {
      crsName: `${project.datum || 'Arc 1960'} / UTM Zone ${project.utm_zone || 37}${project.hemisphere || 'S'}`,
      epsgCode: epsg,
      datum: project.datum || 'Arc 1960',
      ellipsoid: 'Clarke 1880 (RGS)',
      epoch,
      referenceFrame: 'ITRF2014',
    },
    temporalExtent: {
      beginDate: project.survey_date || new Date().toISOString().split('T')[0],
      endDate: project.survey_date || new Date().toISOString().split('T')[0],
    },
    quality: {
      lineage: `Survey observations collected via GNSS/total station, processed through METARDU least-squares adjustment. Datum transformation: EPSG:1165 (Arc 1960 → WGS84, 7-parameter Bursa-Wolf).${project.lsaPassed !== undefined ? ' Global chi-square test: ' + (project.lsaPassed ? 'PASSED' : 'FAILED') + ' at 95% confidence.' : ''}`,
      positionalAccuracy: project.accuracy || 0.05,
      confidenceLevel: 0.95,
      lsaGlobalTestPassed: project.lsaPassed,
    },
    custodian: {
      name: project.user_name,
      organization: project.organization || 'Independent Surveyor',
      email: project.user_email,
      role: 'custodian',
    },
    keywords: [
      project.survey_type || 'cadastral',
      'Kenya',
      'Survey Act Cap. 299',
      'RDM 1.1',
      project.datum || 'Arc 1960',
      epsg,
    ],
    surveyType: project.survey_type || 'cadastral',
    legalReferences: [
      'Survey Act Cap. 299 (Laws of Kenya)',
      'Survey Regulations 1994',
      'RDM 1.1 Accuracy Standards',
      ...(project.surveyorLicense ? [`Surveyor License: ${project.surveyorLicense}`] : []),
    ],
  })
}
