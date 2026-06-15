import { Request, Response } from 'express';
export declare const authController: {
    loginSendOtp: (req: Request, res: Response) => Promise<void>;
    loginVerifyOtp: (req: Request, res: Response) => Promise<void>;
    signupSendOtp: (req: Request, res: Response) => Promise<void>;
    signupVerifyOtp: (req: Request, res: Response) => Promise<void>;
};
//# sourceMappingURL=authController.d.ts.map