import QRCode from 'qrcode'
import { getPublicAppUrl } from '../site'

export async function generateVerificationQR(
  verificationToken: string,
  baseUrl: string
): Promise<string> {
  const url = `${baseUrl}/verify/${verificationToken}`
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    width: 120,
    margin: 1,
    color: { dark: '#000000', light: '#FFFFFF' }
  })
}

export function getVerificationUrl(token: string): string {
  const base = getPublicAppUrl()
  return `${base}/verify/${token}`
}
