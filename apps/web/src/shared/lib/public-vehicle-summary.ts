import type { PublicVehicle } from '@hd/contracts/public';

/** Browser presentation shared by full details and the API's bounded card projection. */
export type PublicVehicleSummary = Pick<PublicVehicle,
  'id' | 'stockCode' | 'identifiers' | 'source' | 'facts' | 'display' | 'price' | 'displayPrice' |
  'availability' | 'detailPath' | 'manufacture' | 'images'
> & { content: Pick<PublicVehicle['content'], 'title'> };
