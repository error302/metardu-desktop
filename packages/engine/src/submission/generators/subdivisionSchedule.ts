/**
 * METARDU — Subdivision Schedule Generator
 * 
 * Generates an HTML/Printable Schedule of Subdivision detailing the
 * areas, lot numbers, and corners for a subdivided parcel.
 */

import type { SubdivisionResult } from '@/types/subdivision'

export interface SubdivisionScheduleData {
  projectName: string
  parentLrNumber: string
  locality: string
  county: string
  surveyorName: string
  firmName: string
  dateOfSurvey: string
  result: SubdivisionResult
}

export function generateSubdivisionSchedule(data: SubdivisionScheduleData): string {
  const currentDate = new Date().toLocaleDateString('en-GB')
  const { result } = data

  let rowsHtml = ''
  
  // Sort lots by number
  const sortedLots = [...result.lots].sort((a, b) => a.lotNumber - b.lotNumber)

  for (const lot of sortedLots) {
    rowsHtml += `
      <tr>
        <td class="px-4 py-2 border border-gray-400 text-center font-bold">${lot.lotNumber}</td>
        <td class="px-4 py-2 border border-gray-400 text-right">${lot.areaHa.toFixed(4)}</td>
        <td class="px-4 py-2 border border-gray-400 text-right">${(lot.areaHa * 10000).toFixed(2)}</td>
        <td class="px-4 py-2 border border-gray-400 text-right">${lot.perimeter.toFixed(2)}</td>
      </tr>
    `
  }

  // Add road reserve if it exists
  if (result.roadReserve && result.roadReserve.areaHa > 0) {
    rowsHtml += `
      <tr class="bg-gray-50">
        <td class="px-4 py-2 border border-gray-400 text-center font-bold">Road Reserve (${result.roadReserve.width}m)</td>
        <td class="px-4 py-2 border border-gray-400 text-right">${result.roadReserve.areaHa.toFixed(4)}</td>
        <td class="px-4 py-2 border border-gray-400 text-right">${(result.roadReserve.areaHa * 10000).toFixed(2)}</td>
        <td class="px-4 py-2 border border-gray-400 text-right">-</td>
      </tr>
    `
  }

  // Summary Row
  rowsHtml += `
    <tr class="bg-gray-200 font-bold">
      <td class="px-4 py-2 border border-gray-400 text-right">TOTAL</td>
      <td class="px-4 py-2 border border-gray-400 text-right">${(result.totalAreaHa + (result.roadReserve?.areaHa ?? 0)).toFixed(4)}</td>
      <td class="px-4 py-2 border border-gray-400 text-right">${((result.totalAreaHa + (result.roadReserve?.areaHa ?? 0)) * 10000).toFixed(2)}</td>
      <td class="px-4 py-2 border border-gray-400 text-right"></td>
    </tr>
  `

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Subdivision Schedule - ${data.parentLrNumber}</title>
  <style>
    body {
      font-family: 'Times New Roman', Times, serif;
      margin: 40px;
      color: #000;
      line-height: 1.5;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .font-bold { font-weight: bold; }
    .font-mono { font-family: monospace; }
    .uppercase { text-transform: uppercase; }
    .text-sm { font-size: 0.875rem; }
    .text-xl { font-size: 1.25rem; }
    .text-2xl { font-size: 1.5rem; }
    .mb-2 { margin-bottom: 0.5rem; }
    .mb-4 { margin-bottom: 1rem; }
    .mb-8 { margin-bottom: 2rem; }
    .mt-8 { margin-top: 2rem; }
    .w-full { width: 100%; }
    .border-collapse { border-collapse: collapse; }
    .border { border: 1px solid #000; }
    .px-4 { padding-left: 1rem; padding-right: 1rem; }
    .py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
    .bg-gray-50 { background-color: #f9fafb; }
    .bg-gray-100 { background-color: #f3f4f6; }
    .bg-gray-200 { background-color: #e5e7eb; }
    
    .grid { display: grid; }
    .grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .gap-4 { gap: 1rem; }
    
    @media print {
      body { margin: 0; padding: 20px; }
      @page { margin: 1cm; }
    }
  </style>
</head>
<body>

  <div class="text-center mb-8">
    <h1 class="text-2xl font-bold uppercase underline">Schedule of Subdivision</h1>
    <h2 class="text-xl mt-2">Republic of Kenya</h2>
  </div>

  <div class="grid grid-cols-2 gap-4 mb-8">
    <div>
      <p><span class="font-bold">Project:</span> ${data.projectName}</p>
      <p><span class="font-bold">Parent L.R. No:</span> ${data.parentLrNumber}</p>
      <p><span class="font-bold">Locality / County:</span> ${data.locality}, ${data.county}</p>
    </div>
    <div class="text-right">
      <p><span class="font-bold">Surveyor:</span> ${data.surveyorName}</p>
      <p><span class="font-bold">Firm:</span> ${data.firmName}</p>
      <p><span class="font-bold">Date of Survey:</span> ${data.dateOfSurvey}</p>
    </div>
  </div>

  <div class="mb-4">
    <p>
      The following is a schedule of the resultant sub-plots from the subdivision of 
      <strong>${data.parentLrNumber}</strong>. Total parent area: <strong>${result.parentParcel.areaHa.toFixed(4)} ha</strong>.
    </p>
  </div>

  <table class="w-full border-collapse mb-8">
    <thead>
      <tr class="bg-gray-100">
        <th class="border border-gray-400 px-4 py-2">Plot Number</th>
        <th class="border border-gray-400 px-4 py-2 text-right">Area (Ha)</th>
        <th class="border border-gray-400 px-4 py-2 text-right">Area (m²)</th>
        <th class="border border-gray-400 px-4 py-2 text-right">Perimeter (m)</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div class="mt-8">
    <div class="grid grid-cols-2 gap-4 mt-8 pt-8">
      <div>
        <p>_____________________________________</p>
        <p class="font-bold mt-2">${data.surveyorName}</p>
        <p>Licensed Surveyor</p>
        <p>${data.firmName}</p>
      </div>
      <div class="text-right">
        <p>Date Generated: ${currentDate}</p>
      </div>
    </div>
  </div>

</body>
</html>
  `

  return html
}
