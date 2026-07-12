'use client';

import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react'
import {
  SurveyingCountry,
  ALL_COUNTRIES,
  getCountryStandard,
  getCountryByISO,
  getTraverseOrderForEnvironment,
  getAreaDecimalPlaces,
  getSlopeRule,
  getBeaconRule,
  getFieldNoteRule,
  getSurveyorReportRequirement,
  type CountrySurveyStandard,
  type TraverseOrderSpec,
  type AreaPrecisionRule,
  type SurveyEnvironment,
} from './standards'

interface CountryContextType {
  country: SurveyingCountry
  standard: CountrySurveyStandard
  t: (key: string, values?: Record<string, string | number>) => string
  setCountry: (country: SurveyingCountry) => void
  getTraverseOrder: (environment: SurveyEnvironment) => TraverseOrderSpec | undefined
  getAreaRule: (sqMetres: number) => AreaPrecisionRule
  getSlope: () => ReturnType<typeof getSlopeRule>
  getBeacon: () => ReturnType<typeof getBeaconRule>
  getFieldNote: () => ReturnType<typeof getFieldNoteRule>
  getReportReq: () => ReturnType<typeof getSurveyorReportRequirement>
  flag: string
  isoCode: string
}

const DEFAULT_COUNTRY: SurveyingCountry = 'kenya'

const CountryContext = createContext<CountryContextType>({
  country: DEFAULT_COUNTRY,
  standard: getCountryStandard(DEFAULT_COUNTRY),
  t: (key) => key,
  setCountry: () => {},
  getTraverseOrder: () => undefined,
  getAreaRule: () => ({ maxHa: Infinity, decimalPlaces: 2, unit: 'm2' as const, regulation: '' }),
  getSlope: () => getSlopeRule(DEFAULT_COUNTRY),
  getBeacon: () => getBeaconRule(DEFAULT_COUNTRY),
  getFieldNote: () => getFieldNoteRule(DEFAULT_COUNTRY),
  getReportReq: () => getSurveyorReportRequirement(DEFAULT_COUNTRY),
  flag: 'KE',
  isoCode: 'KE',
})

function setCountryCookie(country: SurveyingCountry) {
  const maxAgeSeconds = 60 * 60 * 24 * 365
  document.cookie = `metardu_country=${encodeURIComponent(country)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`
}

export function CountryProvider({ children }: { children: ReactNode }) {
  const [country, setCountryState] = useState<SurveyingCountry>(DEFAULT_COUNTRY)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const saved = localStorage.getItem('metardu_country') as SurveyingCountry | null
    if (saved && ALL_COUNTRIES.some((c) => c.id === saved)) {
      setCountryState(saved)
      return
    }

    try {
      const cookies = Object.fromEntries(
        document.cookie.split('; ').map((c) => c.split('='))
      )
      if (cookies['metardu_country']) {
        const cookieCountry = decodeURIComponent(cookies['metardu_country']) as SurveyingCountry
        if (ALL_COUNTRIES.some((c) => c.id === cookieCountry)) {
          setCountryState(cookieCountry)
        }
      }
    } catch {}
  }, [])

  const standard = useMemo(() => getCountryStandard(country), [country])
  const countryInfo = useMemo(() => ALL_COUNTRIES.find((c) => c.id === country), [country])

  const setCountry = useCallback((c: SurveyingCountry) => {
    setCountryState(c)
    localStorage.setItem('metardu_country', c)
    setCountryCookie(c)
  }, [])

  const getAreaRule = useCallback((sqMetres: number) => getAreaDecimalPlaces(country, sqMetres), [country])
  const getSlope = useCallback(() => getSlopeRule(country), [country])
  const getBeacon = useCallback(() => getBeaconRule(country), [country])
  const getFieldNote = useCallback(() => getFieldNoteRule(country), [country])
  const getReportReq = useCallback(() => getSurveyorReportRequirement(country), [country])

  const value = useMemo<CountryContextType>(() => ({
    country,
    standard,
    t: (key) => key,
    setCountry,
    getTraverseOrder: (env) => getTraverseOrderForEnvironment(country, env),
    getAreaRule,
    getSlope,
    getBeacon,
    getFieldNote,
    getReportReq,
    flag: countryInfo?.flag ?? '',
    isoCode: countryInfo?.isoCode ?? 'XX',
  }), [country, standard, setCountry, getAreaRule, getSlope, getBeacon, getFieldNote, getReportReq, countryInfo])

  return (
    <CountryContext.Provider value={value}>
      {children}
    </CountryContext.Provider>
  )
}

export const useCountry = () => useContext(CountryContext)

export { ALL_COUNTRIES, getCountryStandard, getCountryByISO, getTraverseOrderForEnvironment }
export type { SurveyingCountry, CountrySurveyStandard, TraverseOrderSpec, AreaPrecisionRule }
