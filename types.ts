
export enum GrainType {
  RICE = 'Rice',
  WHEAT = 'Wheat',
  CORN = 'Corn',
  SOYBEAN = 'Soybean',
  BARLEY = 'Barley'
}

export interface MoistureReading {
  id: string;
  timestamp: number;
  grainType: GrainType;
  moisturePercentage: number;
  confidence: number;
  notes: string;
}

export interface AudioVisualizerProps {
  isAnalyzing: boolean;
  audioStream: MediaStream | null;
}
