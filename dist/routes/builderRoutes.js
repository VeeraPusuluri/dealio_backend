"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const builderController_1 = require("../controllers/builderController");
const router = (0, express_1.Router)();
router.post('/ensure', builderController_1.builderController.ensureBuilder);
router.post('/:builderId/projects', builderController_1.builderController.createProject);
router.get('/:builderId/projects', builderController_1.builderController.getProjects);
router.get('/:builderId/projects/:projectId', builderController_1.builderController.getProject);
router.patch('/:builderId/projects/:projectId', builderController_1.builderController.updateProject);
router.get('/projects', builderController_1.builderController.getPublicProjects);
// Portal meetings
router.post('/customer/meetings', builderController_1.builderController.bookMeeting);
router.get('/customer/meetings', builderController_1.builderController.getMeetings);
exports.default = router;
//# sourceMappingURL=builderRoutes.js.map