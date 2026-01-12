import { Module, OnModuleInit } from "@nestjs/common";
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
                const webhookDomain = configService.get<string>("WEBHOOK_DOMAIN");

                if (!token) {
                    console.warn("⚠️ BOT_TOKEN topilmadi - bot ishlamaydi");
                    return { token: "dummy_token", launchOptions: false };
                }

                // Webhook rejimi
                if (webhookDomain) {
                    return {
                        token,
                        launchOptions: {
                            webhook: {
                                domain: webhookDomain,
                                hookPath: "/bot/webhook",
                            },
                        },
                    };
                }

                // Polling rejimi (local development uchun)
                return {
                    token,
                    launchOptions: {
                        dropPendingUpdates: true,
                    },
                };
            },
            inject: [ConfigService],
        }),
    ],
    providers: [BotUpdate, BotService],
    exports: [BotService],
})
export class BotModule implements OnModuleInit {
    constructor(
        @InjectBot() private bot: Telegraf,
        private configService: ConfigService
    ) { }

    async onModuleInit() {
        const token = this.configService.get<string>("BOT_TOKEN");
        const webhookDomain = this.configService.get<string>("WEBHOOK_DOMAIN");

        if (token && webhookDomain) {
            console.log(`✅ Telegram bot webhook rejimida: ${webhookDomain}/bot/webhook`);
        } else if (token) {
            console.log("✅ Telegram bot polling rejimida");
        }
    }
}
