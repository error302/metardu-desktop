/**
 * METARDU — Beacon Certificate / Monument Report Generator
 * 
 * Generates an HTML/Printable Beacon Certificate detailing the
 * monuments placed or recovered during a survey.
 */

export interface BeaconEntry {
  pointId: string
  easting: number
  northing: number
  type: string       // e.g., 'IP', 'PB', 'TN', 'MC'
  description: string // e.g., 'Iron Pin in concrete', 'Masonry Nail'
  status: 'Placed' | 'Found' | 'Destroyed'
}

export interface BeaconCertificateData {
  lrNumber: string
  locality: string
  county: string
  surveyorName: string
  iskNumber: string
  firmName: string
  dateOfSurvey: string
  beacons: BeaconEntry[]
}

export function generateBeaconCertificate(data: BeaconCertificateData): string {
  const currentDate = new Date().toLocaleDateString('en-GB')

  let rowsHtml = ''
  for (const b of data.beacons) {
    rowsHtml += `
      <tr>
        <td class="px-4 py-2 border border-gray-400 text-center">${b.pointId}</td>
        <td class="px-4 py-2 border border-gray-400 text-center">${b.type}</td>
        <td class="px-4 py-2 border border-gray-400">${b.description}</td>
        <td class="px-4 py-2 border border-gray-400 text-right font-mono">${b.easting.toFixed(3)}</td>
        <td class="px-4 py-2 border border-gray-400 text-right font-mono">${b.northing.toFixed(3)}</td>
        <td class="px-4 py-2 border border-gray-400 text-center uppercase text-sm">${b.status}</td>
      </tr>
    `
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Beacon Certificate - LR No. ${data.lrNumber}</title>
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
    .bg-gray-100 { background-color: #f3f4f6; }
    
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
    <h1 class="text-2xl font-bold uppercase underline">Beacon Certificate</h1>
    <h2 class="text-xl mt-2">Republic of Kenya</h2>
  </div>

  <div class="grid grid-cols-2 gap-4 mb-8">
    <div>
      <p><span class="font-bold">L.R. Number:</span> ${data.lrNumber}</p>
      <p><span class="font-bold">Locality:</span> ${data.locality}</p>
      <p><span class="font-bold">County:</span> ${data.county}</p>
    </div>
    <div class="text-right">
      <p><span class="font-bold">Surveyor:</span> ${data.surveyorName}</p>
      <p><span class="font-bold">ISK No:</span> ${data.iskNumber}</p>
      <p><span class="font-bold">Date of Survey:</span> ${data.dateOfSurvey}</p>
    </div>
  </div>

  <div class="mb-4">
    <p>This is to certify that the boundary beacons for the above-mentioned parcel have been inspected, placed, or recovered as scheduled below, in accordance with the Survey Act (Cap 299) and Survey Regulations.</p>
  </div>

  <table class="w-full border-collapse mb-8">
    <thead>
      <tr class="bg-gray-100">
        <th class="border border-gray-400 px-4 py-2">Point ID</th>
        <th class="border border-gray-400 px-4 py-2">Type</th>
        <th class="border border-gray-400 px-4 py-2">Description</th>
        <th class="border border-gray-400 px-4 py-2 text-right">Easting (m)</th>
        <th class="border border-gray-400 px-4 py-2 text-right">Northing (m)</th>
        <th class="border border-gray-400 px-4 py-2">Status</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div class="mt-8">
    <p class="mb-8">I certify that the above beacons are in the positions indicated and are of the type and description specified.</p>
    
    <div class="grid grid-cols-2 gap-4 mt-8 pt-8">
      <div>
        <p>_____________________________________</p>
        <p class="font-bold mt-2">${data.surveyorName}</p>
        <p>Licensed Surveyor</p>
        <p>${data.firmName}</p>
      </div>
      <div class="text-right">
        <p>Date: ${currentDate}</p>
      </div>
    </div>
  </div>

</body>
</html>
  `

  return html
}
