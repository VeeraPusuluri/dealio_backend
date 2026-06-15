export declare const users: any[];
export declare const otps: Record<string, string>;
export declare const authService: {
    sendOtp: (phone: string) => {
        success: boolean;
        message: string;
    };
    verifyOtp: (phone: string, otp: string, userData?: {
        fullName?: string;
        role?: string;
    }) => {
        success: boolean;
        data: {
            token: string;
            user: {
                id: any;
                name: any;
                phone: any;
                role: any;
                email: any;
            };
        };
        message?: never;
    } | {
        success: boolean;
        message: string;
        data?: never;
    };
};
//# sourceMappingURL=authService.d.ts.map