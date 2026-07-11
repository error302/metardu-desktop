import type { AttachmentSlot } from '@/types/submission'

// Pre-defined attachment slots for boundary/subdivision submissions
// Extendable for other survey types

export const BOUNDARY_ATTACHMENT_SLOTS: AttachmentSlot[] = [
  {
    id: 'ppa2',
    label: 'Physical Planning Approval (PPA2)',
    required: true,
    accepts: ['application/pdf', 'image/jpeg', 'image/png'],
    max_size_mb: 10,
    help_text: 'Approval from local authority for subdivision / change of user',
    category: 'approval',
  },
  {
    id: 'lcb_consent',
    label: 'Land Control Board Consent',
    required: true,
    accepts: ['application/pdf'],
    max_size_mb: 10,
    help_text: 'Required for subdivisions under the Land Control Act Cap 302',
    category: 'consent',
  },
  {
    id: 'mutation_form',
    label: 'Mutation Form / Subdivision Scheme',
    required: true,
    accepts: ['application/pdf', 'image/jpeg', 'image/png'],
    max_size_mb: 20,
    help_text: 'Form LRA 67 or equivalent, signed by landowner and registered surveyor',
    category: 'approval',
  },
  {
    id: 'rtk_raw',
    label: 'RTK Raw GNSS Output',
    required: false,
    accepts: [
      'text/csv',
      'text/plain',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/xml'
    ],
    max_size_mb: 50,
    help_text: 'Raw GNSS field data from RTK session (CSV, TXT, RINEX, etc.)',
    category: 'field_data',
  },
  {
    id: 'field_book_export',
    label: 'Digital Field Book Export',
    required: false,
    accepts: [
      'text/csv',
      'text/plain',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/xml'
    ],
    max_size_mb: 20,
    help_text: 'Exported from total station / GNSS instrument (.FBK, CSV, LandXML)',
    category: 'field_data',
  },
]

export function getRequiredAttachmentsStatus(
  attachments: Record<string, string>,
  slots: AttachmentSlot[] = BOUNDARY_ATTACHMENT_SLOTS
): { missing: string[]; ready: string[] } {
  const missing: string[] = []
  const ready: string[] = []

  for (const slot of slots) {
    if (attachments[slot.id]) {
      ready.push(slot.label)
    } else if (slot.required) {
      missing.push(slot.label)
    }
  }

  return { missing, ready }
}

