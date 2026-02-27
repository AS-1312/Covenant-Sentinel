import { NextRequest, NextResponse } from 'next/server';

interface FinancialMetrics {
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

interface QuarterData {
  quarter: string;
  year: number;
  metrics: FinancialMetrics;
}

function generateRawFinancialMetrics() {
  const baseValues = {
    // Balance Sheet Items
    totalFinancialIndebtedness: 50000000,
    unrestrictedCash: 8000000,
    totalAssets: 120000000,
    currentAssets: 40000000,
    inventory: 12000000,
    accountsReceivable: 15000000,
    totalEquity: 70000000,
    
    // Income Statement Items
    adjustedEBITDA: 12000000,
    totalCashInterestExpense: 2000000,
    operatingIncome: 10000000,
    grossProfit: 25000000,
    netIncome: 6000000,
    revenue: 80000000,
    costOfGoodsSold: 55000000,
    
    // Cash Flow Items
    unfundedCapEx: 1500000,
    totalDebtService: 3500000,
    capitalExpenditure: 2400000,
    fixedCharges: 2500000,
    
    // Working Capital
    currentLiabilities: 20000000,
    accountsPayable: 8000000
  };

  const randomVariation = () => 0.7 + Math.random() * 0.6; // 0.7 to 1.3

  return {
    totalFinancialIndebtedness: Math.round(baseValues.totalFinancialIndebtedness * randomVariation()),
    unrestrictedCash: Math.round(baseValues.unrestrictedCash * randomVariation()),
    totalAssets: Math.round(baseValues.totalAssets * randomVariation()),
    currentAssets: Math.round(baseValues.currentAssets * randomVariation()),
    inventory: Math.round(baseValues.inventory * randomVariation()),
    accountsReceivable: Math.round(baseValues.accountsReceivable * randomVariation()),
    totalEquity: Math.round(baseValues.totalEquity * randomVariation()),
    adjustedEBITDA: Math.round(baseValues.adjustedEBITDA * randomVariation()),
    totalCashInterestExpense: Math.round(baseValues.totalCashInterestExpense * randomVariation()),
    operatingIncome: Math.round(baseValues.operatingIncome * randomVariation()),
    grossProfit: Math.round(baseValues.grossProfit * randomVariation()),
    netIncome: Math.round(baseValues.netIncome * randomVariation()),
    revenue: Math.round(baseValues.revenue * randomVariation()),
    costOfGoodsSold: Math.round(baseValues.costOfGoodsSold * randomVariation()),
    unfundedCapEx: Math.round(baseValues.unfundedCapEx * randomVariation()),
    totalDebtService: Math.round(baseValues.totalDebtService * randomVariation()),
    capitalExpenditure: Math.round(baseValues.capitalExpenditure * randomVariation()),
    fixedCharges: Math.round(baseValues.fixedCharges * randomVariation()),
    currentLiabilities: Math.round(baseValues.currentLiabilities * randomVariation()),
    accountsPayable: Math.round(baseValues.accountsPayable * randomVariation())
  };
}

function calculateMetrics(rawMetrics: ReturnType<typeof generateRawFinancialMetrics>): FinancialMetrics {
  // Leverage Ratios
  const totalNetLeverageRatio = (rawMetrics.totalFinancialIndebtedness - rawMetrics.unrestrictedCash) / rawMetrics.adjustedEBITDA;
  const debtToEquityRatio = rawMetrics.totalFinancialIndebtedness / rawMetrics.totalEquity;
  const seniorDebtToEBITDA = rawMetrics.totalFinancialIndebtedness / rawMetrics.adjustedEBITDA;
  
  // Coverage Ratios
  const interestCoverageRatio = rawMetrics.adjustedEBITDA / rawMetrics.totalCashInterestExpense;
  const debtServiceCoverageRatio = (rawMetrics.adjustedEBITDA - rawMetrics.unfundedCapEx) / rawMetrics.totalDebtService;
  const fixedChargeCoverageRatio = (rawMetrics.adjustedEBITDA + rawMetrics.fixedCharges) / rawMetrics.fixedCharges;
  
  // Liquidity Ratios
  const currentRatio = rawMetrics.currentAssets / rawMetrics.currentLiabilities;
  const quickRatio = (rawMetrics.currentAssets - rawMetrics.inventory) / rawMetrics.currentLiabilities;
  const liquidityRatio = rawMetrics.unrestrictedCash / rawMetrics.totalFinancialIndebtedness;
  const cashConversionCycle = 45 + Math.random() * 30; // Days
  
  // Profitability Ratios
  const grossProfitMargin = rawMetrics.grossProfit / rawMetrics.revenue;
  const operatingProfitMargin = rawMetrics.operatingIncome / rawMetrics.revenue;
  const netProfitMargin = rawMetrics.netIncome / rawMetrics.revenue;
  const returnOnAssets = rawMetrics.netIncome / rawMetrics.totalAssets;
  const returnOnEquity = rawMetrics.netIncome / rawMetrics.totalEquity;
  
  // Efficiency Ratios
  const assetTurnoverRatio = rawMetrics.revenue / rawMetrics.totalAssets;
  const inventoryTurnoverRatio = rawMetrics.costOfGoodsSold / rawMetrics.inventory;
  const receivablesTurnoverRatio = rawMetrics.revenue / rawMetrics.accountsReceivable;
  
  // Capital Expenditure
  const capitalExpenditureRatio = rawMetrics.capitalExpenditure / rawMetrics.revenue;
  const capexToRevenue = rawMetrics.capitalExpenditure / rawMetrics.revenue;

  return {
    // Leverage Ratios
    totalNetLeverageRatio: Math.round(totalNetLeverageRatio * 100) / 100,
    debtToEquityRatio: Math.round(debtToEquityRatio * 100) / 100,
    seniorDebtToEBITDA: Math.round(seniorDebtToEBITDA * 100) / 100,
    
    // Coverage Ratios
    interestCoverageRatio: Math.round(interestCoverageRatio * 100) / 100,
    debtServiceCoverageRatio: Math.round(debtServiceCoverageRatio * 100) / 100,
    fixedChargeCoverageRatio: Math.round(fixedChargeCoverageRatio * 100) / 100,
    
    // Liquidity Ratios
    currentRatio: Math.round(currentRatio * 100) / 100,
    quickRatio: Math.round(quickRatio * 100) / 100,
    liquidityRatio: Math.round(liquidityRatio * 1000) / 1000,
    cashConversionCycle: Math.round(cashConversionCycle),
    
    // Profitability Ratios
    grossProfitMargin: Math.round(grossProfitMargin * 10000) / 100,
    operatingProfitMargin: Math.round(operatingProfitMargin * 10000) / 100,
    netProfitMargin: Math.round(netProfitMargin * 10000) / 100,
    returnOnAssets: Math.round(returnOnAssets * 10000) / 100,
    returnOnEquity: Math.round(returnOnEquity * 10000) / 100,
    
    // Efficiency Ratios
    assetTurnoverRatio: Math.round(assetTurnoverRatio * 100) / 100,
    inventoryTurnoverRatio: Math.round(inventoryTurnoverRatio * 100) / 100,
    receivablesTurnoverRatio: Math.round(receivablesTurnoverRatio * 100) / 100,
    
    // Capital Expenditure
    capitalExpenditureRatio: Math.round(capitalExpenditureRatio * 1000) / 1000,
    capexToRevenue: Math.round(capexToRevenue * 1000) / 1000
  };
}

function generateQuarterData(quarter: string, year: number): QuarterData {
  const rawMetrics = generateRawFinancialMetrics();
  const metrics = calculateMetrics(rawMetrics);
  
  return {
    quarter,
    year,
    metrics
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ quarter?: string }> }
) {
  try {
    const resolvedParams = await params;
    const quarterParam = resolvedParams.quarter;
    let quarterNum = 1; // Default to Q1
    
    if (quarterParam) {
      quarterNum = parseInt(quarterParam);
      if (isNaN(quarterNum) || quarterNum < 1 || quarterNum > 4) {
        return NextResponse.json(
          { error: 'Quarter must be between 1 and 4' },
          { status: 400 }
        );
      }
    }
    
    const quarterData = generateQuarterData(`Q${quarterNum}`, 2026);
    
    return NextResponse.json(quarterData);
    
  } catch (error) {
    console.error('Error generating borrower financials:', error);
    return NextResponse.json(
      { error: 'Failed to generate borrower financial data' },
      { status: 500 }
    );
  }
}
