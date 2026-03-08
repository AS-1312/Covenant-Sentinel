// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ILoanHealthFeed {
    struct CovenantReport {
        string covenantName;            // e.g., "Maximum Leverage Ratio"
        CovenantStatus status;          // PASS / WARNING / BREACH
        uint256 calculatedValue;        // Actual metric value (scaled by 1e18)
        uint256 threshold;              // Threshold at time of check (scaled by 1e18)
        uint256 confidenceScore;        // Multi-model consensus confidence (0-100)
        TrendIndicator trend;           // Direction of metric movement
        string notes;                   // AI-generated observation (optional)
    }

    struct LoanHealthReport {
        bytes32 loanId;                         // Reference to LoanRegistry entry
        uint256 reportTimestamp;                // When this report was published
        uint256 reportIndex;                    // Sequential report number for this loan
        CovenantStatus overallStatus;           // Worst status across all covenants
        CovenantReport[] covenantReports;       // Per-covenant breakdown
        TrendIndicator overallTrend;            // Composite trend across all covenants
        uint256 overallConfidenceScore;         // Aggregate multi-model confidence (0-100)
        string riskNarrative;                   // AI-generated summary of loan health
        bool isActive;                          // Whether loan is still being monitored
    }

    struct LoanHealthSummary {
        bytes32 loanId;
        CovenantStatus overallStatus;
        TrendIndicator overallTrend;
        uint256 overallConfidenceScore;
        uint256 lastUpdated;
        uint256 totalReports;
        uint256 totalBreaches;
        uint256 totalWarnings;
    }

    struct PublishReportInput {
        bytes32 loanId;
        CovenantStatus overallStatus;
        TrendIndicator overallTrend;
        uint256 overallConfidenceScore;
        string riskNarrative;
        string[] covenantNames;
        CovenantStatus[] statuses;
        uint256[] calculatedValues;
        uint256[] thresholds;
        uint256[] confidenceScores;
        TrendIndicator[] trends;
        string[] notes;
    }

    enum CovenantStatus {
        PASS,       // Metric within acceptable range
        WARNING,    // Metric deteriorating but not yet breached
        BREACH      // Metric has crossed the threshold
    }

    enum TrendIndicator {
        IMPROVING,
        STABLE,
        DETERIORATING
    }

    function getLatestReport(bytes32 loanId)
        external
        view
        returns (
            CovenantStatus overallStatus,
            TrendIndicator overallTrend,
            uint256 overallConfidenceScore,
            uint256 reportTimestamp,
            uint256 reportIndex,
            string memory riskNarrative,
            bool isActive
        );

    function getLatestCovenantReports(bytes32 loanId)
        external
        view
        returns (CovenantReport[] memory);

    function getCovenantStatus(bytes32 loanId, string calldata covenantName)
        external
        view
        returns (
            CovenantStatus status,
            uint256 calculatedValue,
            uint256 threshold,
            uint256 confidenceScore,
            TrendIndicator trend
        );

    function getHistoricalReport(bytes32 loanId, uint256 reportIndex)
        external
        view
        returns (
            CovenantStatus overallStatus,
            TrendIndicator overallTrend,
            uint256 overallConfidenceScore,
            uint256 reportTimestamp,
            string memory riskNarrative
        );

    function getLoanSummary(bytes32 loanId)
        external
        view
        returns (LoanHealthSummary memory);

    function getRecentStatusHistory(bytes32 loanId, uint256 n)
        external
        view
        returns (CovenantStatus[] memory statuses, uint256[] memory timestamps);

    function isLoanInBreach(bytes32 loanId) external view returns (bool);

    function isLoanMonitored(bytes32 loanId) external view returns (bool);

    function getActiveBreaches() external view returns (bytes32[] memory);

    function getMonitoredLoanCount() external view returns (uint256);

    function reportCount(bytes32 loanId) external view returns (uint256);

    function breachCount(bytes32 loanId) external view returns (uint256);

    function warningCount(bytes32 loanId) external view returns (uint256);
}