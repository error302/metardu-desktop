/**
 * Country Survey Standards — Public API
 *
 * Usage:
 *   import { useCountry } from '../country'
 *   const { country, standard, getTraverseOrder, getAreaRule } = useCountry()
 *
 * Or without React:
 *   import { getCountryStandard, getTraverseOrderForEnvironment } from '../country'
 *   const std = getCountryStandard('kenya')
 *   const order = getTraverseOrderForEnvironment('kenya', 'urban')
 */

export {
  CountryProvider,
  useCountry,
  ALL_COUNTRIES,
  getCountryStandard,
  getCountryByISO,
  getTraverseOrderForEnvironment,
} from './context'

export {
  getAreaDecimalPlaces,
  getSlopeRule,
  getBeaconRule,
  getFieldNoteRule,
  getSurveyorReportRequirement,
} from './standards'

export type {
  SurveyingCountry,
  CountrySurveyStandard,
  TraverseOrderSpec,
  AreaPrecisionRule,
  SurveyEnvironment,
} from './standards'
