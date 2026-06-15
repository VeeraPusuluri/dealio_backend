"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.builderController = exports.meetings = exports.builders = exports.projects = void 0;
const express_1 = require("express");
// Mock DB for Projects
exports.projects = [];
exports.builders = [];
exports.meetings = [];
exports.builderController = {
    ensureBuilder: async (req, res) => {
        const { name, email, phone, userId } = req.body;
        let builder = exports.builders.find(b => b.email === email || (userId && b.userId === userId));
        if (!builder) {
            builder = {
                id: exports.builders.length + 1001,
                name,
                email,
                phone,
                userId: userId || null,
                createdAt: new Date().toISOString()
            };
            exports.builders.push(builder);
        }
        res.json({ ok: true, data: { builderId: builder.id } });
    },
    createProject: async (req, res) => {
        const { builderId } = req.params;
        const projectData = req.body;
        const newProject = {
            ...projectData,
            id: exports.projects.length + 5001,
            builderId: Number(builderId),
            published: projectData.published ?? true,
            status: projectData.status || 'ACTIVE',
            createdAt: new Date().toISOString()
        };
        exports.projects.push(newProject);
        res.json({ ok: true, data: newProject });
    },
    getProjects: async (req, res) => {
        const { builderId } = req.params;
        const { status } = req.query;
        let filtered = exports.projects.filter(p => p.builderId === Number(builderId));
        if (status) {
            filtered = filtered.filter(p => p.status === status);
        }
        res.json({ ok: true, data: filtered });
    },
    getProject: async (req, res) => {
        const { projectId } = req.params;
        const project = exports.projects.find(p => p.id === Number(projectId));
        if (project) {
            res.json({ ok: true, data: project });
        }
        else {
            res.status(404).json({ ok: false, message: 'Project not found' });
        }
    },
    updateProject: async (req, res) => {
        const { projectId } = req.params;
        const updateData = req.body;
        const index = exports.projects.findIndex(p => p.id === Number(projectId));
        if (index !== -1) {
            exports.projects[index] = { ...exports.projects[index], ...updateData };
            res.json({ ok: true, data: exports.projects[index] });
        }
        else {
            res.status(404).json({ ok: false, message: 'Project not found' });
        }
    },
    getPublicProjects: async (req, res) => {
        const { city } = req.query;
        let filtered = exports.projects.filter(p => p.published);
        if (city) {
            filtered = filtered.filter(p => p.city?.toLowerCase() === city.toLowerCase());
        }
        res.json({ ok: true, data: filtered });
    },
    // Portal (Meeting) interactions
    bookMeeting: async (req, res) => {
        const meetingData = req.body;
        const newMeeting = {
            ...meetingData,
            id: exports.meetings.length + 9001,
            status: 'Pending',
            createdAt: new Date().toISOString()
        };
        exports.meetings.push(newMeeting);
        res.json({ ok: true, data: newMeeting });
    },
    getMeetings: async (req, res) => {
        const { phone } = req.query;
        let filtered = exports.meetings;
        if (phone) {
            filtered = filtered.filter(m => m.customerPhone === phone);
        }
        res.json({ ok: true, data: filtered });
    }
};
//# sourceMappingURL=builderController.js.map