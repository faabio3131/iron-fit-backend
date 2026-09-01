export declare class CreateAssessmentDto {
    studentId?: string;
    weight?: number;
    height?: number;
    bmi?: number;
    bodyFatPercent?: number;
    measurements?: {
        chest?: number;
        waist?: number;
        hip?: number;
        rightArm?: number;
        leftArm?: number;
        rightThigh?: number;
        leftThigh?: number;
        rightCalf?: number;
        leftCalf?: number;
    };
    restrictions?: {
        injuries?: string[];
        conditions?: string[];
        medications?: string[];
        notes?: string;
    };
    notes?: string;
}
