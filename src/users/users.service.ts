import { Injectable, ConflictException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateUserDto, UpdateUserDto } from "./dto/create-user.dto";
import { Role } from "@prisma/client";
import * as bcrypt from "bcrypt";

@Injectable()
export class UsersService {
    constructor(private prisma: PrismaService) { }

    async findAll(role?: Role) {
        const users = await this.prisma.user.findMany({
            where: role ? { role } : undefined,
            include: {
                station: { select: { id: true, name: true } },
                usedChecks: {
                    select: {
                        station: { select: { id: true, name: true } },
                    },
                    orderBy: { createdAt: "desc" },
                    take: 1,
                },
            },
            orderBy: { createdAt: "desc" },
        });

        return users.map(({ password, usedChecks, ...user }) => ({
            ...user,
            lastStation: usedChecks?.[0]?.station || null,
        }));
    }

    async findOne(id: number) {
        const user = await this.prisma.user.findUnique({
            where: { id },
            include: {
                station: { select: { id: true, name: true } },
            },
        });

        if (!user) return null;
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }

    async findByUsername(username: string) {
        return this.prisma.user.findUnique({ where: { username } });
    }

    async findByTelegramId(telegramId: string) {
        return this.prisma.user.findUnique({ where: { telegramId } });
    }

    async findByPhone(phone: string) {
        return this.prisma.user.findUnique({ where: { phone } });
    }

    async create(dto: CreateUserDto) {
        try {
            let hashedPassword: string | undefined;
            if (dto.password) {
                hashedPassword = await bcrypt.hash(dto.password, 10);
            }

            const user = await this.prisma.user.create({
                data: {
                    ...dto,
                    password: hashedPassword,
                },
            });

            const { password, ...userWithoutPassword } = user;
            return userWithoutPassword;
        } catch (error: any) {
            if (error.code === "P2002") {
                throw new ConflictException("Bu username yoki telefon allaqachon mavjud");
            }
            throw error;
        }
    }

    async update(id: number, dto: UpdateUserDto) {
        if (dto.password) {
            dto.password = await bcrypt.hash(dto.password, 10);
        }

        const user = await this.prisma.user.update({
            where: { id },
            data: dto,
        });

        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }

    async updateBalance(userId: number, amount: number) {
        return this.prisma.user.update({
            where: { id: userId },
            data: {
                balanceLiters: { increment: amount },
            },
        });
    }

    async registerViaTelegram(data: {
        telegramId: string;
        telegramUsername?: string;
        fullName?: string;
        phone?: string;
    }) {
        const existing = await this.findByTelegramId(data.telegramId);
        if (existing) {
            return existing;
        }

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

    async getRanking(limit: number = 100) {
        return this.prisma.user.findMany({
            where: { role: "customer", isActive: true },
            select: {
                id: true,
                fullName: true,
                phone: true,
                balanceLiters: true,
                createdAt: true,
            },
            orderBy: { balanceLiters: "desc" },
            take: limit,
        });
    }

    async getTopCustomers(order: "asc" | "desc" = "desc", limit: number = 10) {
        return this.prisma.user.findMany({
            where: { role: "customer", isActive: true },
            select: {
                id: true,
                fullName: true,
                phone: true,
                balanceLiters: true,
                _count: { select: { usedChecks: true } },
            },
            orderBy: { balanceLiters: order },
            take: limit,
        });
    }

    async getUserRank(userId: number) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { balanceLiters: true },
        });

        if (!user) return null;

        const rank = await this.prisma.user.count({
            where: {
                role: "customer",
                isActive: true,
                balanceLiters: { gt: user.balanceLiters },
            },
        });

        return rank + 1;
    }

    async getStationCustomers(stationId: number) {
        return this.prisma.user.findMany({
            where: {
                role: "customer",
                usedChecks: {
                    some: { stationId },
                },
            },
            select: {
                id: true,
                fullName: true,
                phone: true,
                balanceLiters: true,
                _count: {
                    select: { usedChecks: { where: { stationId } } },
                },
            },
            orderBy: { balanceLiters: "desc" },
        });
    }

    async delete(id: number) {
        return this.prisma.user.delete({ where: { id } });
    }

    async getCustomersReport(order: "asc" | "desc" = "desc") {
        return this.prisma.user.findMany({
            where: { role: "customer", isActive: true },
            select: {
                id: true,
                fullName: true,
                phone: true,
                telegramUsername: true,
                balanceLiters: true,
                createdAt: true,
                _count: { select: { usedChecks: true } },
            },
            orderBy: { balanceLiters: order },
        });
    }

    async getCustomersForExport() {
        return this.prisma.user.findMany({
            where: { role: "customer" },
            select: {
                id: true,
                fullName: true,
                phone: true,
                telegramUsername: true,
                balanceLiters: true,
                isActive: true,
                createdAt: true,
                _count: { select: { usedChecks: true } },
            },
            orderBy: { balanceLiters: "desc" },
        });
    }
}
