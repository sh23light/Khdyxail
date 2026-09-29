import { Router, type IRouter } from "express";
import healthRouter from "./health";
import emailRouter from "./email";
import contactsRouter from "./contacts";
import rulesRouter from "./rules";
import aiRouter from "./ai";
import authRouter from "./auth";
import tokensRouter from "./tokens";

const router: IRouter = Router();

router.use(healthRouter);
router.use(emailRouter);
router.use(contactsRouter);
router.use(rulesRouter);
router.use(aiRouter);
router.use(authRouter);
router.use(tokensRouter);

export default router;
