import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCheckDto, UseCheckDto } from "./dto/check.dto";
import { QrService } from "./qr.service";
import { randomBytes } from "crypto";
import * as ExcelJS from "exceljs";

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

    async findAll(filters?: {
        stationId?: number;
        status?: string;
        operatorId?: number;
        isPrinted?: boolean;
        page?: number;
        limit?: number;
    }) {
        const page = filters?.page || 1;
        const limit = filters?.limit || 100;
        const skip = (page - 1) * limit;

        const where = {
            ...(filters?.stationId && { stationId: filters.stationId }),
            ...(filters?.status && { status: filters.status as any }),
            ...(filters?.operatorId && { operatorId: filters.operatorId }),
            ...(filters?.isPrinted !== undefined && { isPrinted: filters.isPrinted }),
        };

        // Chop etilmagan cheklar uchun qrCode ham qaytariladi
        const includeQrCode = filters?.isPrinted === false;

        const [data, total] = await Promise.all([
            this.prisma.check.findMany({
                where,
                select: {
                    id: true,
                    code: true,
                    qrCode: includeQrCode,
                    amountLiters: true,
                    status: true,
                    isPrinted: true,
                    customerName: true,
                    customerPhone: true,
                    customerAddress: true,
                    operatorId: true,
                    stationId: true,
                    customerId: true,
                    usedAt: true,
                    createdAt: true,
                    expiresAt: true,
                    operator: { select: { id: true, fullName: true, username: true } },
                    customer: { select: { id: true, fullName: true, phone: true, telegramId: true } },
                    station: { select: { id: true, name: true } },
                },
                orderBy: { createdAt: "desc" },
                skip,
                take: limit,
            }),
            this.prisma.check.count({ where }),
        ]);

        return {
            data,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
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
        const digits = phone.replace(/\D/g, "");
        return digits.slice(-9);
    }

    async create(dto: CreateCheckDto) {
        const code = this.generateCode();

        const botUsername = this.configService.get<string>("BOT_USERNAME") || "ayoqsh_bot";
        const telegramLink = `https://t.me/${botUsername}?start=check_${code}`;
        const qrCode = await this.qrService.generateQRCode(telegramLink);

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        let customerId: number | null = null;

        if (dto.customerPhone && dto.customerPhone.trim()) {
            const normalizedPhone = this.normalizePhone(dto.customerPhone);

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
            customerId = customer.id;

            if (dto.autoUse) {
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
        }

        const check = await this.prisma.check.create({
            data: {
                code,
                qrCode,
                amountLiters: dto.amountLiters,
                operatorId: dto.operatorId,
                stationId: dto.stationId,
                customerName: dto.customerName || null,
                customerPhone: dto.customerPhone || null,
                customerAddress: dto.customerAddress || null,
                customerId,
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

    async deleteCheck(id: number) {
        const check = await this.prisma.check.findUnique({ where: { id } });

        if (!check) {
            throw new NotFoundException("Chek topilmadi");
        }

        if (check.status === "used" && check.customerId) {
            await this.prisma.$transaction([
                this.prisma.check.delete({ where: { id } }),
                this.prisma.user.update({
                    where: { id: check.customerId },
                    data: {
                        balanceLiters: { decrement: check.amountLiters },
                    },
                }),
            ]);
            return { deleted: true, balanceUpdated: true };
        }

        await this.prisma.check.delete({ where: { id } });
        return { deleted: true, balanceUpdated: false };
    }

    async reactivateCheck(id: number, amountLiters: number, operatorId: number) {
        const originalCheck = await this.prisma.check.findUnique({
            where: { id },
            include: { customer: true, station: true },
        });

        if (!originalCheck) {
            throw new NotFoundException("Chek topilmadi");
        }

        if (!originalCheck.customerId) {
            throw new BadRequestException("Bu chekda mijoz mavjud emas");
        }

        const code = this.generateCode();
        const botUsername = this.configService.get<string>("BOT_USERNAME") || "ayoqsh_bot";
        const telegramLink = `https://t.me/${botUsername}?start=check_${code}`;
        const qrCode = await this.qrService.generateQRCode(telegramLink);

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        const [newCheck] = await this.prisma.$transaction([
            this.prisma.check.create({
                data: {
                    code,
                    qrCode,
                    amountLiters,
                    operatorId,
                    stationId: originalCheck.stationId,
                    customerName: originalCheck.customerName,
                    customerPhone: originalCheck.customerPhone,
                    customerAddress: originalCheck.customerAddress,
                    customerId: originalCheck.customerId,
                    status: "used",
                    usedAt: new Date(),
                    expiresAt,
                },
                include: {
                    customer: { select: { id: true, fullName: true, phone: true, balanceLiters: true } },
                    station: { select: { id: true, name: true } },
                },
            }),
            this.prisma.user.update({
                where: { id: originalCheck.customerId },
                data: {
                    balanceLiters: { increment: amountLiters },
                },
            }),
        ]);

        return newCheck;
    }

    async confirmCheck(id: number) {
        const check = await this.prisma.check.findUnique({ where: { id } });

        if (!check) {
            throw new NotFoundException("Chek topilmadi");
        }

        return this.prisma.check.update({
            where: { id },
            data: {
                isPrinted: true,
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

    async exportToExcel(startDate: Date, endDate: Date): Promise<Buffer> {
        const checks = await this.prisma.check.findMany({
            where: {
                createdAt: {
                    gte: startDate,
                    lte: endDate,
                },
            },
            select: {
                id: true,
                code: true,
                amountLiters: true,
                status: true,
                customerName: true,
                customerPhone: true,
                createdAt: true,
                usedAt: true,
                customer: {
                    select: {
                        telegramId: true,
                        fullName: true,
                        phone: true,
                    },
                },
                station: { select: { name: true } },
                operator: { select: { fullName: true } },
            },
            orderBy: { createdAt: "desc" },
        });

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("Cheklar");

        worksheet.columns = [
            { header: "№", key: "index", width: 5 },
            { header: "Telegram ID", key: "telegramId", width: 15 },
            { header: "Ism Familiya", key: "fullName", width: 25 },
            { header: "Telefon", key: "phone", width: 18 },
            { header: "Chek kodi", key: "code", width: 12 },
            { header: "Litr", key: "liters", width: 10 },
            { header: "Chop etilgan sana", key: "createdAt", width: 18 },
            { header: "Ro'yxatdan o'tgan sana", key: "usedAt", width: 18 },
            { header: "Holat", key: "status", width: 12 },
            { header: "Shaxobcha", key: "station", width: 20 },
            { header: "Operator", key: "operator", width: 20 },
        ];

        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF4472C4" },
        };
        worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

        checks.forEach((check, index) => {
            const statusMap: Record<string, string> = {
                pending: "Kutilmoqda",
                printed: "Chop etilgan",
                used: "Ishlatilgan",
                expired: "Muddati o'tgan",
                cancelled: "Bekor qilingan",
            };

            const formatDate = (date: Date) => {
                const uzDate = new Date(date.getTime() + 5 * 60 * 60 * 1000);
                const day = String(uzDate.getUTCDate()).padStart(2, "0");
                const month = String(uzDate.getUTCMonth() + 1).padStart(2, "0");
                const year = uzDate.getUTCFullYear();
                const hours = String(uzDate.getUTCHours()).padStart(2, "0");
                const minutes = String(uzDate.getUTCMinutes()).padStart(2, "0");
                return `${day}/${month}/${year}, ${hours}:${minutes}`;
            };

            worksheet.addRow({
                index: index + 1,
                telegramId: check.customer?.telegramId || "-",
                fullName: check.customer?.fullName || check.customerName || "-",
                phone: check.customer?.phone || check.customerPhone || "-",
                code: check.code,
                liters: Number(check.amountLiters),
                createdAt: formatDate(check.createdAt),
                usedAt: check.usedAt ? formatDate(check.usedAt) : "-",
                status: statusMap[check.status] || check.status,
                station: check.station?.name || "-",
                operator: check.operator?.fullName || "-",
            });
        });

        worksheet.eachRow((row, rowNumber) => {
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: "thin" },
                    left: { style: "thin" },
                    bottom: { style: "thin" },
                    right: { style: "thin" },
                };
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(buffer);
    }
}
