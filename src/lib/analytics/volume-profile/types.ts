export interface VolumeProfileInputCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}

export interface VolumeProfileBin {
  index: number;
  priceLow: number;
  priceHigh: number;
  volume: number;
  normalizedVolume: number;
}

export interface VolumeProfileCluster { priceLow: number; priceHigh: number; volume: number; binIndexes: number[]; }

export type VolumeProfileResult = {
  status: 'available';
  version: 'nexora-vpvr-v1';
  methodology: string;
  bins: VolumeProfileBin[];
  poc: VolumeProfileBin;
  vah: number;
  val: number;
  hvnClusters: VolumeProfileCluster[];
  lvnClusters: VolumeProfileCluster[];
  totalInputVolume: number;
  totalAllocatedVolume: number;
  coverage: number;
} | {
  status: 'unavailable';
  version: 'nexora-vpvr-v1';
  methodology: string;
  reason: string;
  coverage: number;
};
