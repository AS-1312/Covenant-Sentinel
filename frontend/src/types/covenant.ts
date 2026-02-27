export interface FinancialMetrics {
  // Leverage Ratios
  totalNetLeverageRatio: number;
  debtToEquityRatio: number;
  seniorDebtToEBITDA: number;
  
  // Coverage Ratios
  interestCoverageRatio: number;
  debtServiceCoverageRatio: number;
  fixedChargeCoverageRatio: number;
  
  // Liquidity Ratios
  currentRatio: number;
  quickRatio: number;
  liquidityRatio: number;
  cashConversionCycle: number;
  
  // Profitability Ratios
  grossProfitMargin: number;
  operatingProfitMargin: number;
  netProfitMargin: number;
  returnOnAssets: number;
  returnOnEquity: number;
  
  // Efficiency Ratios
  assetTurnoverRatio: number;
  inventoryTurnoverRatio: number;
  receivablesTurnoverRatio: number;
  
  // Capital Expenditure
  capitalExpenditureRatio: number;
  capexToRevenue: number;
}

export interface QuarterData {
  quarter: string;
  year: number;
  metrics: FinancialMetrics;
}

export type BorrowerFinancialsResponse = QuarterData;
