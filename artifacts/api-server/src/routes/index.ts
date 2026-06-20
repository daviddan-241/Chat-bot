import { Router, type IRouter } from "express";
import healthRouter from "./health";
import chatRouter from "./chat";
import imagesRouter from "./images";
import filesRouter from "./files";
import videosRouter from "./videos";
import settingsRouter from "./settings";
import agentsRouter from "./agents";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/chat", chatRouter);
router.use("/images", imagesRouter);
router.use("/files", filesRouter);
router.use("/videos", videosRouter);
router.use("/settings", settingsRouter);
router.use("/agents", agentsRouter);

export default router;
