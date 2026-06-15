"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const morgan_1 = __importDefault(require("morgan"));
const dotenv_1 = __importDefault(require("dotenv"));
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const builderRoutes_1 = __importDefault(require("./routes/builderRoutes"));
const customerRoutes_1 = __importDefault(require("./routes/customerRoutes"));
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// morgan is noisy in tests, maybe skip it or use a different format
if (process.env.NODE_ENV !== 'test') {
    app.use((0, morgan_1.default)('dev'));
}
// Basic health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Dealio Backend is running' });
});
// Routes
app.use('/api/auth', authRoutes_1.default);
app.use('/api/builder', builderRoutes_1.default);
app.use('/api/portal', builderRoutes_1.default);
app.use('/api/customer-portal/customer', customerRoutes_1.default);
exports.default = app;
//# sourceMappingURL=app.js.map