"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.customerController = void 0;
const express_1 = require("express");
const builderController_1 = require("./builderController");
exports.customerController = {
    getCities: async (req, res) => {
        const cities = Array.from(new Set(builderController_1.projects.map(p => p.city).filter(Boolean)));
        // Add some default cities if none in projects
        const defaultCities = ['Hyderabad', 'Bengaluru', 'Mumbai', 'Pune', 'Delhi NCR', 'Chennai'];
        const result = cities.length > 0 ? cities : defaultCities;
        res.json({ ok: true, data: result });
    },
    getProjects: async (req, res) => {
        const { city } = req.query;
        let filtered = builderController_1.projects.filter(p => p.published);
        if (city) {
            filtered = filtered.filter(p => p.city?.toLowerCase() === city.toLowerCase());
        }
        res.json({ ok: true, data: filtered });
    },
    getProject: async (req, res) => {
        const { id } = req.params;
        const project = builderController_1.projects.find(p => p.id === Number(id));
        if (project) {
            res.json({ ok: true, data: project });
        }
        else {
            res.status(404).json({ ok: false, message: 'Project not found' });
        }
    }
};
//# sourceMappingURL=customerController.js.map