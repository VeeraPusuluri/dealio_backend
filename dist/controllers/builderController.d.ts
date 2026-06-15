import { Request, Response } from 'express';
export declare const projects: any[];
export declare const builders: any[];
export declare const meetings: any[];
export declare const builderController: {
    ensureBuilder: (req: Request, res: Response) => Promise<void>;
    createProject: (req: Request, res: Response) => Promise<void>;
    getProjects: (req: Request, res: Response) => Promise<void>;
    getProject: (req: Request, res: Response) => Promise<void>;
    updateProject: (req: Request, res: Response) => Promise<void>;
    getPublicProjects: (req: Request, res: Response) => Promise<void>;
    bookMeeting: (req: Request, res: Response) => Promise<void>;
    getMeetings: (req: Request, res: Response) => Promise<void>;
};
//# sourceMappingURL=builderController.d.ts.map