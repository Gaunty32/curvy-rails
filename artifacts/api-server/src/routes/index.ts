import { Router, type IRouter } from "express";
import healthRouter from "./health";
import curvyRailsRouter from "./curvy-rails";

const router: IRouter = Router();

router.use(healthRouter);
router.use(curvyRailsRouter);

export default router;
