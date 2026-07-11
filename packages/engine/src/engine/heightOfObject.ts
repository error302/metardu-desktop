export type HeightOfObjectResult = {
  heightFromHI: number
  totalHeight: number
}

/**
 * Height of object from horizontal distance and vertical angles.
 * H = D·(tanα − tanβ) + HI
 */
export function heightOfObject(input: {
  horizontalDistance: number
  angleTopDeg: number
  angleBaseDeg: number
  instrumentHeight: number
}): HeightOfObjectResult {
  const alphaRad = (input.angleTopDeg * Math.PI) / 180
  const betaRad = (input.angleBaseDeg * Math.PI) / 180
  const heightFromHI = input.horizontalDistance * (Math.tan(alphaRad) - Math.tan(betaRad))
  const totalHeight = heightFromHI + input.instrumentHeight
  return { heightFromHI, totalHeight }
}

