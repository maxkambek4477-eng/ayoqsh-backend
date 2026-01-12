import { Module, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { TelegrafModule, InjectBot } from "nestjs-telegraf";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Telegraf } from "telegraf";
import { BotUpdate } from "./bot.update";
import { BotService } from "./bot.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
    imports: [
        PrismaModule,
        TelegrafModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: (configService: ConfigService) => {
                const token = configService.get<string>("BOT_TOKEN");
                if (!token) {
                    console.warn("⚠️ BOT_TOKEN topilmadi - bot ishlamaydi");
                }
                return {
                    token: token || "dummy_token",
                    launchOptions: token ? {
                        dropPendingUpdates: true,
                        allowedUpdates: ["message", "callback_query"],
                    } : false,
                };
            },
            inject: [ConfigService],
        }),
    ],
    providers: [BotUpdate, BotService],
    exports: [BotService],
})
export class BotModule implements OnModuleInit, OnModuleDestroy {
    constructor(
        @InjectBot() private bot: Telegraf,
        private configService: ConfigService
    ) { }

    async onModuleInit() {
        const token = this.configService.get<string>("BOT_TOKEN");
        if (token) {
            try {
                // Avvalgi webhook yoki polling ni tozalash
                await this.bot.telegram.deleteWebhook({ drop_pending_updates: true });
                console.log("✅ Telegram bot tayyor");
            } catch (error: any) {
                console.error("❌ Bot init xatosi:", error.message);
            }
        }
    }

    async onModuleDestroy() {
        try {
            await this.bot.stop("SIGTERM");
            console.log("🛑 Telegram bot to'xtatildi");
        } catch (error: any) {
            console.error("Bot to'xtatishda xatolik:", error.message);
        }
    }
}
