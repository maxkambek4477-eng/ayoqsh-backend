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

    // Webhook endpoint (agar webhook rejimi yoqilgan bo'lsa)
    const webhookDomain = process.env.WEBHOOK_DOMAIN;
    if (webhookDomain) {
        const bot = app.get(getBotToken());
        app.use(bot.webhookCallback("/bot/webhook"));
    }

    // Graceful shutdown
    app.enableShutdownHooks();

    const port = process.env.PORT || 3001;
    await app.listen(port, "0.0.0.0");
    console.log(`🚀 NestJS server running on http://0.0.0.0:${port}`);

    // Process signallarini ushlash
    const shutdown = async (signal: string) => {
        console.log(`\n📴 ${signal} signal qabul qilindi, server yopilmoqda...`);
        await app.close();
        process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((err) => {
    console.error("❌ Server xatosi:", err.message);
    if (err.message?.includes("409") || err.message?.includes("Conflict")) {
        console.error("⚠️ Telegram bot boshqa joyda ishlayapti. Avvalgi processni to'xtating!");
        process.exit(1);
    }
});
