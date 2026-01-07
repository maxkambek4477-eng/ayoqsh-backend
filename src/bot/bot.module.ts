import { Module } from "@nestjs/common";
import { TelegrafModule } from "nestjs-telegraf";
import { ConfigModule, ConfigService } from "@nestjs/config";
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
                        webhook: undefined,
                        dropPendingUpdates: true, // Eski xabarlarni o'tkazib yuborish
                    } : false, 
                };
            },
            inject: [ConfigService],
        }),
    ],
    providers: [BotUpdate, BotService],
    exports: [BotService],
})
export class BotModule { }
