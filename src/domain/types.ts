export type EncounterType = 'protetiva' | 'faccao' | 'generico';

export interface EntityProfile {
  readonly idMonitorado: number;
  readonly faccaoMonitorado: string;
  readonly medidaProtetiva: boolean;
  readonly idsRestricaoMedida: ReadonlySet<number>;
}

export interface PositionRecord {
  readonly idMonitorado: number;
  readonly timestamp: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly profile: EntityProfile;
}

export interface EncounterPosition {
  readonly lat: number;
  readonly lon: number;
}

export interface Encounter {
  readonly tipo: EncounterType;
  readonly monitoradosEncontro: [number, number];
  readonly timestamp: string;
  readonly posicoes: Record<string, EncounterPosition>;
  readonly distanciaMetros: number;
}
