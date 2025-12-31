import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCheckDto, UseCheckDto } from "./dto/check.dto";
import { QrService } from "./qr.service";
import { randomBytes } from "crypto";

@Injectable()
export class ChecksService {
    constructor(
        private prisma: PrismaService,
        private qrService: QrService,
        private configService: ConfigService
    ) { }

    private generateCode(): string {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let code = "";
        const bytes = randomBytes(8);
        for (let i = 0; i < 8; i++) {
            code += chars[bytes[i] % chars.length];
        }
        return code;
    }

    async findAll(filters?: { stationId?: number; status?: string; operatorId?: number }) {
        return this.prisma.check.findMany({
            where: {
                ...(filters?.stationId && { stationId: filters.stationId }),
                ...(filters?.status && { status: filters.status as any }),
                ...(filters?.operatorId && { operatorId: filters.operatorId }),
            },
            include: {
                operator: { select: { id: true, fullName: true, username: true } },
                customer: { select: { id: true, fullName: true, phone: true, telegramId: true } },
                station: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: "desc" },
        });
    }

    async findByCode(code: string) {
        return this.prisma.check.findUnique({
            where: { code },
            include: {
                operator: { select: { fullName: true } },
                station: { select: { name: true } },
            },
        });
    }

    private normalizePhone(phone: string): string {
        // Telefon raqamidan faqat raqamlarni olish va oxirgi 9 ta raqamni qaytarish
        const digits = phone.replace(/\D/g, "");
        return digits.slice(-9);
    }

    async create(dto: CreateCheckDto) {
        const code = this.generateCode();

        // QR kod generatsiya qilish
        const botUsername = this.configService.get<string>("BOT_USERNAME") || "ayoqsh_bot";
        const telegramLink = `https://t.me/${botUsername}?start=check_${code}`;
        const qrCode = await this.qrService.generateQRCode(telegramLink);

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        // Telefon raqamini normallashtirish
        const normalizedPhone = this.normalizePhone(dto.customerPhone || "");

        // Mijozni telefon raqami bo'yicha topish (turli formatlarni tekshirish)
        let customer = await this.prisma.user.findFirst({
            where: {
                OR: [
                    { phone: dto.customerPhone },
                    { phone: { endsWith: normalizedPhone } },
                    { phone: `+998${normalizedPhone}` },
                    { phone: `998${normalizedPhone}` },
                ],
            },
        });

        if (!customer) {
            customer = await this.prisma.user.create({
                data: {
                    phone: dto.customerPhone,
                    fullName: dto.customerName,
                    role: "customer",
                    balanceLiters: 0,
                },
            });
        }

        // Chek yaratish
        if (dto.autoUse) {
            // Qayta qo'shish - darhol used va balansga qo'shish
            const [check] = await this.prisma.$transaction([
                this.prisma.check.create({
                    data: {
                        code,
                        qrCode,
                        amountLiters: dto.amountLiters,
                        operatorId: dto.operatorId,
                        stationId: dto.stationId,
                        customerName: dto.customerName,
                        customerPhone: dto.customerPhone,
                        customerAddress: dto.customerAddress,
                        customerId: customer.id,
                        status: "used",
                        usedAt: new Date(),
                        expiresAt,
                    },
                    include: {
                        station: { select: { name: true } },
                    },
                }),
                this.prisma.user.update({
                    where: { id: customer.id },
                    data: {
                        balanceLiters: { increment: dto.amountLiters },
                    },
                }),
            ]);
            return check;
        }

        // Oddiy yaratish - kutilmoqda holatida
        const check = await this.prisma.check.create({
            data: {
                code,
                qrCode,
                amountLiters: dto.amountLiters,
                operatorId: dto.operatorId,
                stationId: dto.stationId,
                customerName: dto.customerName,
                customerPhone: dto.customerPhone,
                customerAddress: dto.customerAddress,
                customerId: customer.id,
                status: "pending",
                expiresAt,
            },
            include: {
                station: { select: { name: true } },
            },
        });

        return check;
    }

    async useCheck(dto: UseCheckDto) {
        const check = await this.prisma.check.findUnique({
            where: { code: dto.code },
        });

        if (!check) {
            throw new NotFoundException("Chek topilmadi");
        }

        if (check.status !== "pending") {
            throw new BadRequestException("Bu chek allaqachon ishlatilgan yoki bekor qilingan");
        }

        if (new Date() > check.expiresAt) {
            await this.prisma.check.update({
                where: { id: check.id },
                data: { status: "expired" },
            });
            throw new BadRequestException("Chek muddati tugagan");
        }

        const [updatedCheck] = await this.prisma.$transaction([
            this.prisma.check.update({
                where: { id: check.id },
                data: {
                    status: "used",
                    customerId: dto.customerId,
                    usedAt: new Date(),
                },
            }),
            this.prisma.user.update({
                where: { id: dto.customerId },
                data: {
                    balanceLiters: {
                        increment: check.amountLiters,
                    },
                },
            }),
        ]);

        return updatedCheck;
    }

    async cancelCheck(id: number) {
        const check = await this.prisma.check.findUnique({ where: { id } });

        if (!check) {
            throw new NotFoundException("Chek topilmadi");
        }

        if (check.status !== "pending") {
            throw new BadRequestException("Faqat kutilayotgan chekni bekor qilish mumkin");
        }

        return this.prisma.check.update({
            where: { id },
            data: { status: "cancelled" },
        });
    }

    async confirmCheck(id: number) {
        const check = await this.prisma.check.findUnique({ where: { id } });

        if (!check) {
            throw new NotFoundException("Chek topilmadi");
        }

        if (check.status !== "pending") {
            throw new BadRequestException("Faqat kutilayotgan chekni tasdiqlash mumkin");
        }

        if (new Date() > check.expiresAt) {
            await this.prisma.check.update({
                where: { id },
                data: { status: "expired" },
            });
            throw new BadRequestException("Chek muddati tugagan");
        }

        return this.prisma.check.update({
            where: { id },
            data: {
                status: "used",
                usedAt: new Date(),
            },
        });
    }

    async getOperatorDailyStats(operatorId: number) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [todayChecks, todayLiters, totalChecks] = await Promise.all([
            this.prisma.check.count({
                where: {
                    operatorId,
                    createdAt: { gte: today },
                },
            }),
            this.prisma.check.aggregate({
                where: {
                    operatorId,
                    createdAt: { gte: today },
                },
                _sum: { amountLiters: true },
            }),
            this.prisma.check.count({ where: { operatorId } }),
        ]);

        return {
            todayChecks,
            todayLiters: Number(todayLiters._sum.amountLiters || 0),
            totalChecks,
        };
    }

    async getQrCode(id: number) {
        const check = await this.prisma.check.findUnique({
            where: { id },
            select: { qrCode: true, code: true },
        });

        if (!check) {
            throw new NotFoundException("Chek topilmadi");
        }

        return check;
    }
}
