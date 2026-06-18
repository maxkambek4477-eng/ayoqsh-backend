import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { getBotToken } from "nestjs-telegraf";
import { AppModule } from "./app.module";

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

    // CORS sozlamalari
    app.enableCors({
        origin: [
            'https://www.nbsgazoil.uz',
            'https://nbsgazoil.uz',
            'http://localhost:5173',
            'http://localhost:5174'
        ],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    });

    const port = process.env.PORT || 3001;
    await app.listen(port, "0.0.0.0");
    console.log(`🚀 NestJS server running on http://0.0.0.0:${port}`);

    // Webhook endpoint (listen dan KEYIN qo'shamiz)
    const webhookDomain = process.env.WEBHOOK_DOMAIN;
    if (webhookDomain) {
        try {
            const bot = app.get(getBotToken());
            const httpAdapter = app.getHttpAdapter();
            const expressApp = httpAdapter.getInstance();

            // Body ni to'g'ridan o'qish
            expressApp.post("/bot/webhook", async (req: any, res: any) => {
                try {
                    const update = req.body;
                    console.log('📥 Webhook received, update_id:', update?.update_id || 'NO UPDATE');

                    if (!update) {
                        return res.status(400).json({ error: "No body" });
                    }

                    await bot.handleUpdate(update);
                    res.status(200).json({ ok: true });
                } catch (error: any) {
                    console.error("Webhook xatosi:", error.message);
                    res.status(200).json({ ok: true });
                }
            });

            console.log(`✅ Webhook route active: ${webhookDomain}/bot/webhook`);
        } catch (e) {
            console.warn("⚠️ Webhook qo'shilmadi:", e);
        }
    }

    // SIGINT/SIGTERM handlerlarni o'chirish — PM2 bilan muammo chiqarmaslik uchun
}

bootstrap().catch((err) => {
    console.error("❌ Server xatosi:", err.message);
    if (err.message?.includes("409") || err.message?.includes("Conflict")) {
        console.error("⚠️ Telegram bot boshqa joyda ishlayapti. Avvalgi processni to'xtating!");
        process.exit(1);
    }
});
