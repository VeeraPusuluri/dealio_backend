"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const customerController_1 = require("../controllers/customerController");
const router = (0, express_1.Router)();
router.get('/cities', customerController_1.customerController.getCities);
router.get('/projects', customerController_1.customerController.getProjects);
router.get('/projects/:id', customerController_1.customerController.getProject);
exports.default = router;
//# sourceMappingURL=customerRoutes.js.map