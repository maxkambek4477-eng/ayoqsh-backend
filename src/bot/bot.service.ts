import { Injectable } from "@nestjs/common";
import { InjectBot } from "nestjs-telegraf";
import { Telegraf } from "telegraf";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class BotService {
    constructor(
        private prisma: PrismaService,
        @InjectBot() private bot: Telegraf
    ) { }

    async findUserByTelegramId(telegramId: string) {
        return this.prisma.user.findUnique({
            where: { telegramId },
            include: { station: { select: { id: true, name: true } } },
        });
    }

    async findUserByPhone(phone: string) {
        return this.prisma.user.findUnique({ where: { phone } });
    }

    async createUser(data: {
        telegramId: string;
        telegramUsername?: string;
        fullName: string;
        phone: string;
    }) {
        return this.prisma.user.create({
            data: {
                telegramId: data.telegramId,
                telegramUsername: data.telegramUsername,
                fullName: data.fullName,
                phone: data.phone,
                role: "customer",
            },
        });
    }

    async getUserProfile(telegramId: string) {
        const user = await this.prisma.user.findUnique({
            where: { telegramId },
            include: { _count: { select: { usedChecks: true } } },
        });

        if (!user) return null;

        return {
            fullName: user.fullName,
            phone: user.phone,
            balanceLiters: user.balanceLiters,
            checksCount: user._count.usedChecks,
        };
    }

    async getUserStats(telegramId: string) {
        const user = await this.prisma.user.findUnique({ where: { telegramId } });
        if (!user) return null;

        const thisMonth = new Date();
        thisMonth.setDate(1);
        thisMonth.setHours(0, 0, 0, 0);

        const monthlyChecks = await this.prisma.check.aggregate({
            where: { customerId: user.id, usedAt: { gte: thisMonth } },
            _sum: { amountLiters: true },
            _count: true,
        });

        return {
            balance: user.balanceLiters,
            monthlyChecks: monthlyChecks._count,
            monthlyLiters: Number(monthlyChecks._sum.amountLiters || 0),
        };
    }

    async useCheck(code: string, userId: number) {
        const check = await this.prisma.check.findUnique({
            where: { code },
            include: { station: { select: { name: true } } },
        });

        if (!check) {
            return { success: false, message: "Chek topilmadi!" };
        }

        // Faqat pending statusidagi cheklar ishlatilishi mumkin
        if (check.status !== "pending") {
            const statusText =
                check.status === "used" ? "allaqachon ishlatilgan" :
                    check.status === "expired" ? "muddati tugagan" : "bekor qilingan";
            return { success: false, message: `Bu chek ${statusText}!` };
        }

        if (new Date() > check.expiresAt) {
            await this.prisma.check.update({
                where: { id: check.id },
                data: { status: "expired" },
            });
            return { success: false, message: "Chek muddati tugagan!" };
        }

        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            return { success: false, message: "Foydalanuvchi topilmadi!" };
        }

        if (check.customerPhone) {
            const normalizedCheckPhone = check.customerPhone.replace(/\D/g, "").slice(-9);
            const normalizedUserPhone = (user.phone || "").replace(/\D/g, "").slice(-9);

            if (normalizedCheckPhone !== normalizedUserPhone) {
                return { success: false, message: "Bu chek sizga tegishli emas!" };
            }
        }

        await this.prisma.$transaction([
            this.prisma.check.update({
                where: { id: check.id },
                data: { status: "used", customerId: userId, usedAt: new Date() },
            }),
            this.prisma.user.update({
                where: { id: userId },
                data: { balanceLiters: { increment: check.amountLiters } },
            }),
        ]);

        const newBalance = Number(user.balanceLiters) + Number(check.amountLiters);

        return {
            success: true,
            message: "Chek qabul qilindi!",
            amount: check.amountLiters,
            stationId: check.stationId,
            stationName: check.station?.name || "",
            newBalance,
        };
    }

    async sendMessageToUser(telegramId: string, message: string) {
        try {
            await this.bot.telegram.sendMessage(telegramId, message, { parse_mode: "Markdown" });
            return true;
        } catch (error) {
            console.error("Xabar yuborishda xatolik:", error);
            return false;
        }
    }

    async broadcastMessage(title: string, content: string) {
        const customers = await this.prisma.user.findMany({
            where: { role: "customer", isActive: true, telegramId: { not: null } },
            select: { telegramId: true },
        });

        let sent = 0;
        let failed = 0;

        for (const customer of customers) {
            if (customer.telegramId) {
                const success = await this.sendMessageToUser(
                    customer.telegramId,
                    `📢 *${title}*\n\n${content}`
                );
                if (success) sent++;
                else failed++;
                await new Promise((r) => setTimeout(r, 50));
            }
        }

        return { sent, failed };
    }
}
