// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract LoanHealthFeed is AccessControl {
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

    mapping(bytes32 => bool) isMonitored;
    mapping(bytes32 => LoanHealthReport) latestReports;
    mapping(bytes32 => mapping(uint256 => LoanHealthReport)) reportHistory;

    bytes32 public constant WORKFLOW_ROLE = keccak256("WORKFLOW_ROLE");

    mapping(bytes32 => uint256) public reportCount;
    mapping(bytes32 => uint256) public breachCount;
    bytes32[] public monitoredLoans;
    mapping(bytes32 => uint256) public warningCount;
    bytes32[] public activeBreaches;
    mapping(bytes32 => bool) public isInBreach;

    event LoanHealthReportPublished(
        bytes32 indexed loanId,
        uint256 reportIndex,
        CovenantStatus overallStatus,
        TrendIndicator overallTrend,
        uint256 overallConfidenceScore,
        uint256 timestamp
    );

    event CovenantBreach(
        bytes32 indexed loanId,
        string covenantName,
        uint256 calculatedValue,
        uint256 threshold,
        uint256 confidenceScore,
        uint256 timestamp
    );

    event CovenantWarning(
        bytes32 indexed loanId,
        string covenantName,
        uint256 calculatedValue,
        uint256 threshold,
        uint256 timestamp
    );

    event BreachResolved(
        bytes32 indexed loanId,
        uint256 timestamp
    );

    event LoanMonitoringActivated(
        bytes32 indexed loanId,
        uint256 timestamp
    );

    event LoanMonitoringDeactivated(
        bytes32 indexed loanId,
        uint256 timestamp
    );

    error LoanNotMonitored(bytes32 loanId);
    error AtleastOneCovenantRequired(bytes32 loanId);
    error ArrayLengthMismatch(bytes32 loanId);
    error InvalidConfidenceScore(bytes32 loanId, uint256 score);

    modifier loanIsMonitored(bytes32 loanId) {
        _loanIsMonitored(loanId);
        _;
    }


    constructor(address authorizedWorkflow) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(WORKFLOW_ROLE, authorizedWorkflow);
    }

    /**
     * @notice Publish a new loan health report
     * @dev Called by the CRE monitoring workflow after multi-model consensus
     * @param input Bundled report data from the CRE workflow
     */
    function publishHealthReport(
        PublishReportInput calldata input
    ) external onlyRole(WORKFLOW_ROLE) {
        if (input.covenantNames.length == 0) {
            revert AtleastOneCovenantRequired(input.loanId);
        }
        if (
            input.covenantNames.length != input.statuses.length ||
            input.covenantNames.length != input.calculatedValues.length ||
            input.covenantNames.length != input.thresholds.length ||
            input.covenantNames.length != input.confidenceScores.length ||
            input.covenantNames.length != input.trends.length ||
            input.covenantNames.length != input.notes.length
        ) {
            revert ArrayLengthMismatch(input.loanId);
        }
        if (input.overallConfidenceScore > 100) {
            revert InvalidConfidenceScore(input.loanId, input.overallConfidenceScore);
        }

        uint256 currentReportIndex = reportCount[input.loanId];

        LoanHealthReport storage report = reportHistory[input.loanId][currentReportIndex];
        report.loanId = input.loanId;
        report.reportTimestamp = block.timestamp;
        report.reportIndex = currentReportIndex;
        report.overallStatus = input.overallStatus;
        report.overallTrend = input.overallTrend;
        report.overallConfidenceScore = input.overallConfidenceScore;
        report.riskNarrative = input.riskNarrative;
        report.isActive = true;

        for (uint256 i = 0; i < input.covenantNames.length; i++) {
            report.covenantReports.push(CovenantReport({
                covenantName: input.covenantNames[i],
                status: input.statuses[i],
                calculatedValue: input.calculatedValues[i],
                threshold: input.thresholds[i],
                confidenceScore: input.confidenceScores[i],
                trend: input.trends[i],
                notes: input.notes[i]
            }));

            if (input.statuses[i] == CovenantStatus.BREACH) {
                emit CovenantBreach(
                    input.loanId,
                    input.covenantNames[i],
                    input.calculatedValues[i],
                    input.thresholds[i],
                    input.confidenceScores[i],
                    block.timestamp
                );
            } else if (input.statuses[i] == CovenantStatus.WARNING) {
                emit CovenantWarning(
                    input.loanId,
                    input.covenantNames[i],
                    input.calculatedValues[i],
                    input.thresholds[i],
                    block.timestamp
                );
            }
        }

        latestReports[input.loanId] = report;

        reportCount[input.loanId]++;
        if (input.overallStatus == CovenantStatus.BREACH) {
            breachCount[input.loanId]++;
        } else if (input.overallStatus == CovenantStatus.WARNING) {
            warningCount[input.loanId]++;
        }

        _updateBreachState(input.loanId, input.overallStatus);

        if (!isMonitored[input.loanId]) {
            isMonitored[input.loanId] = true;
            monitoredLoans.push(input.loanId);
            emit LoanMonitoringActivated(input.loanId, block.timestamp);
        }

        emit LoanHealthReportPublished(
            input.loanId,
            currentReportIndex,
            input.overallStatus,
            input.overallTrend,
            input.overallConfidenceScore,
            block.timestamp
        );
    }

    /**
     * @notice Deactivate monitoring for a loan (e.g., loan fully repaid)
     */
    function deactivateLoan(bytes32 loanId)
        external
        onlyRole(WORKFLOW_ROLE)
        loanIsMonitored(loanId)
    {
        latestReports[loanId].isActive = false;
        emit LoanMonitoringDeactivated(loanId, block.timestamp);
    }

    function getLatestReport(bytes32 loanId)
        public
        view
        loanIsMonitored(loanId)
        returns (
            CovenantStatus overallStatus,
            TrendIndicator overallTrend,
            uint256 overallConfidenceScore,
            uint256 reportTimestamp,
            uint256 reportIndex,
            string memory riskNarrative,
            bool isActive
        )
    {
        LoanHealthReport storage report = latestReports[loanId];
        return (
            report.overallStatus,
            report.overallTrend,
            report.overallConfidenceScore,
            report.reportTimestamp,
            report.reportIndex,
            report.riskNarrative,
            report.isActive
        );
    }

    function getLatestCovenantReports(bytes32 loanId)
        public
        view
        loanIsMonitored(loanId)
        returns (CovenantReport[] memory)
    {
        return latestReports[loanId].covenantReports;
    }

    function getCovenantStatus(bytes32 loanId, string calldata covenantName)
        public
        view
        loanIsMonitored(loanId)
        returns (
            CovenantStatus status,
            uint256 calculatedValue,
            uint256 threshold,
            uint256 confidenceScore,
            TrendIndicator trend
        )
    {
        CovenantReport[] storage reports = latestReports[loanId].covenantReports;
        for (uint256 i = 0; i < reports.length; i++) {
            if (keccak256(bytes(reports[i].covenantName)) == keccak256(bytes(covenantName))) {
                return (
                    reports[i].status,
                    reports[i].calculatedValue,
                    reports[i].threshold,
                    reports[i].confidenceScore,
                    reports[i].trend
                );
            }
        }
        revert("LoanHealthFeed: Covenant not found in latest report");
    }

    function getHistoricalReport(bytes32 loanId, uint256 reportIndex)
        public
        view
        loanIsMonitored(loanId)
        returns (
            CovenantStatus overallStatus,
            TrendIndicator overallTrend,
            uint256 overallConfidenceScore,
            uint256 reportTimestamp,
            string memory riskNarrative
        )
    {
        require(reportIndex < reportCount[loanId], "LoanHealthFeed: Report index out of range");
        LoanHealthReport storage report = reportHistory[loanId][reportIndex];
        return (
            report.overallStatus,
            report.overallTrend,
            report.overallConfidenceScore,
            report.reportTimestamp,
            report.riskNarrative
        );
    }

    function getLoanSummary(bytes32 loanId)
        public
        view
        loanIsMonitored(loanId)
        returns (LoanHealthSummary memory)
    {
        LoanHealthReport storage latest = latestReports[loanId];
        return LoanHealthSummary({
            loanId: loanId,
            overallStatus: latest.overallStatus,
            overallTrend: latest.overallTrend,
            overallConfidenceScore: latest.overallConfidenceScore,
            lastUpdated: latest.reportTimestamp,
            totalReports: reportCount[loanId],
            totalBreaches: breachCount[loanId],
            totalWarnings: warningCount[loanId]
        });
    }

    function isLoanInBreach(bytes32 loanId) public view returns (bool) {
        return isInBreach[loanId];
    }

    function getActiveBreaches() public view returns (bytes32[] memory) {
        return activeBreaches;
    }

    function getRecentStatusHistory(bytes32 loanId, uint256 n)
        public
        view
        loanIsMonitored(loanId)
        returns (
            CovenantStatus[] memory statuses,
            uint256[] memory timestamps
        )
    {
        uint256 total = reportCount[loanId];
        uint256 count = n > total ? total : (n > 20 ? 20 : n);

        statuses = new CovenantStatus[](count);
        timestamps = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            uint256 index = total - count + i;
            LoanHealthReport storage report = reportHistory[loanId][index];
            statuses[i] = report.overallStatus;
            timestamps[i] = report.reportTimestamp;
        }

        return (statuses, timestamps);
    }

    function getMonitoredLoanCount() public view returns (uint256) {
        return monitoredLoans.length;
    }

    function isLoanMonitored(bytes32 loanId) public view returns (bool) {
        return isMonitored[loanId];
    }

    function _updateBreachState(bytes32 loanId, CovenantStatus newStatus) internal {
        bool currentlyInBreach = isInBreach[loanId];

        if (newStatus == CovenantStatus.BREACH && !currentlyInBreach) {
            isInBreach[loanId] = true;
            activeBreaches.push(loanId);

        } else if (newStatus != CovenantStatus.BREACH && currentlyInBreach) {
            isInBreach[loanId] = false;
            _removeFromActiveBreaches(loanId);
            emit BreachResolved(loanId, block.timestamp);
        }
    }

    function _removeFromActiveBreaches(bytes32 loanId) internal {
        uint256 length = activeBreaches.length;
        for (uint256 i = 0; i < length; i++) {
            if (activeBreaches[i] == loanId) {
                activeBreaches[i] = activeBreaches[length - 1];
                activeBreaches.pop();
                break;
            }
        }
    }

    function _loanIsMonitored(bytes32 loanId) internal view {
        if (!isMonitored[loanId]) {
            revert LoanNotMonitored(loanId);
        }
    }
}