import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe, Res } from "@nestjs/common";
import { Response } from "express";
import { UsersService } from "./users.service";
import { CreateUserDto, UpdateUserDto } from "./dto/create-user.dto";
import { Role } from "@prisma/client";
import * as ExcelJS from "exceljs";

@Controller("api/users")
export class UsersController {
    constructor(private usersService: UsersService) { }

    @Get()
    findAll(
        @Query("role") role?: Role,
        @Query("page") page?: string,
        @Query("limit") limit?: string
    ) {
        return this.usersService.findAll(
            role,
            page ? parseInt(page) : 1,
            limit ? parseInt(limit) : 100
        );
    }

    @Get("ranking")
    getRanking(@Query("limit") limit?: string) {
        return this.usersService.getRanking(limit ? parseInt(limit) : 100);
    }

    @Get("top")
    getTopCustomers(
        @Query("order") order?: "asc" | "desc",
        @Query("limit") limit?: string
    ) {
        return this.usersService.getTopCustomers(order || "desc", limit ? parseInt(limit) : 10);
    }

    @Get("report")
    getCustomersReport(
        @Query("order") order?: "asc" | "desc",
        @Query("page") page?: string,
        @Query("limit") limit?: string
    ) {
        return this.usersService.getCustomersReport(
            order || "desc",
            page ? parseInt(page) : 1,
            limit ? parseInt(limit) : 50
        );
    }

    @Get("export/excel")
    async exportToExcel(@Res() res: Response) {
        const customers = await this.usersService.getCustomersForExport();

        const workbook = new ExcelJS.Workbook();
        workbook.creator = "AYoQSH";
        workbook.created = new Date();

        const sheet = workbook.addWorksheet("Mijozlar hisoboti");

        sheet.columns = [
            { header: "№", key: "index", width: 6 },
            { header: "F.I.O", key: "fullName", width: 25 },
            { header: "Telefon", key: "phone", width: 18 },
            { header: "Telegram", key: "telegram", width: 18 },
            { header: "Balans (L)", key: "balance", width: 12 },
            { header: "Cheklar soni", key: "checks", width: 12 },
            { header: "Holat", key: "status", width: 10 },
            { header: "Ro'yxatdan o'tgan", key: "createdAt", width: 18 },
        ];

        sheet.getRow(1).font = { bold: true };
        sheet.getRow(1).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF4472C4" },
        };
        sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

        customers.forEach((customer, index) => {
            sheet.addRow({
                index: index + 1,
                fullName: customer.fullName || "-",
                phone: customer.phone || "-",
                telegram: customer.telegramUsername ? `@${customer.telegramUsername}` : "-",
                balance: Number(customer.balanceLiters).toFixed(2),
                checks: customer._count.usedChecks,
                status: customer.isActive ? "Faol" : "Nofaol",
                createdAt: new Date(customer.createdAt).toLocaleDateString("uz-UZ"),
            });
        });

        const totalRow = sheet.addRow({
            index: "",
            fullName: "JAMI:",
            phone: "",
            telegram: "",
            balance: customers.reduce((sum, c) => sum + Number(c.balanceLiters), 0).toFixed(2),
            checks: customers.reduce((sum, c) => sum + c._count.usedChecks, 0),
            status: "",
            createdAt: "",
        });
        totalRow.font = { bold: true };

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename=mijozlar-hisoboti-${new Date().toISOString().split("T")[0]}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();
    }

    @Get("station/:stationId/customers")
    getStationCustomers(
        @Param("stationId", ParseIntPipe) stationId: number,
        @Query("page") page?: string,
        @Query("limit") limit?: string
    ) {
        return this.usersService.getStationCustomers(
            stationId,
            page ? parseInt(page) : 1,
            limit ? parseInt(limit) : 50
        );
    }

    @Get(":id")
    findOne(@Param("id", ParseIntPipe) id: number) {
        return this.usersService.findOne(id);
    }

    @Get(":id/rank")
    getUserRank(@Param("id", ParseIntPipe) id: number) {
        return this.usersService.getUserRank(id);
    }

    @Post()
    create(@Body() dto: CreateUserDto) {
        return this.usersService.create(dto);
    }

    @Put(":id")
    update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
        return this.usersService.update(id, dto);
    }

    @Delete(":id")
    delete(@Param("id", ParseIntPipe) id: number) {
        return this.usersService.delete(id);
    }
}
