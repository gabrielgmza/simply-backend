// ============================================
// SIMPLY SECURITY SERVICES - INDEX
// Backend v3.8.0 - Advanced Security
// ============================================

export { trustScoreService } from './trustScoreService';
export { riskBasedAuthService } from './riskBasedAuthService';
export { deviceFingerprintService } from './deviceFingerprintService';
export { killSwitchService } from './killSwitchService';
export { employeeAnomalyService } from './employeeAnomalyService';
export { behavioralAnalyticsService } from './behavioralAnalyticsService';
export { enhancedFraudService } from './enhancedFraudService';
export { realTimeAlertingService } from './realTimeAlertingService';

// Types
export type { TrustScoreResult, TrustScoreComponents, TrustScoreBenefits } from './trustScoreService';
export type { RiskAssessment, RiskLevel, AuthAction } from './riskBasedAuthService';
export type { DeviceInfo, DeviceTrustLevel } from './deviceFingerprintService';
export type { KillSwitchState, KillSwitchScope, KillSwitchProduct } from './killSwitchService';
export type { EmployeeAnomaly, AnomalyType, AnomalySeverity } from './employeeAnomalyService';
export type { UserBehaviorProfile, UserSegment, BehaviorAnomaly } from './behavioralAnalyticsService';
export type { FraudEvaluation, FraudRiskLevel, FraudDecision } from './enhancedFraudService';
export type { Alert, AlertChannel, AlertPriority, AlertCategory } from './realTimeAlertingService';
