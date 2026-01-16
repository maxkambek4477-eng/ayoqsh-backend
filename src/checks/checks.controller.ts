import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { ChecksService } from "./checks.service";
import { CreateCheckDto, UseCheckDto } from "./dto/check.dto";
import { QrService } from "./qr.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/decorators";

@Controller("api/checks")
export class ChecksController {
    constructor(
        private checksService: ChecksService,
        private qrService: QrService
    ) { }

    @Get("export/excel")
    async exportExcel(
        @Query("startDate") startDate: string,
        @Query("endDate") endDate: string,
        @Res() res: Response
    ) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);

        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        const buffer = await this.checksService.exportToExcel(start, end);

        const filename = `cheklar_${startDate}_${endDate}.xlsx`;

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(buffer);
    }

    @Get()
    findAll(
        @Query("stationId") stationId?: string,
        @Query("status") status?: string,
        @Query("operatorId") operatorId?: string,
        @Query("isPrinted") isPrinted?: string,
        @Query("page") page?: string,
        @Query("limit") limit?: string
    ) {
        return this.checksService.findAll({
            stationId: stationId ? parseInt(stationId) : undefined,
            status,
            operatorId: operatorId ? parseInt(operatorId) : undefined,
            isPrinted: isPrinted !== undefined ? isPrinted === "true" : undefined,
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 100,
        });
    }

    @Get("code/:code")
    findByCode(@Param("code") code: string) {
        return this.checksService.findByCode(code);
    }

    @Get("operator/:id/stats")
    getOperatorStats(@Param("id", ParseIntPipe) id: number) {
        return this.checksService.getOperatorDailyStats(id);
    }

    @Get(":id/qr")
    async getQrCode(@Param("id", ParseIntPipe) id: number) {
        return this.checksService.getQrCode(id);
    }

    @Get(":id/qr/image")
    async getQrCodeImage(@Param("id", ParseIntPipe) id: number, @Res() res: Response) {
        const check = await this.checksService.getQrCode(id);
        if (!check || !check.qrCode) {
            return res.status(404).send("QR kod topilmadi");
        }

        const base64Data = check.qrCode.replace(/^data:image\/png;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");

        res.setHeader("Content-Type", "image/png");
        res.setHeader("Content-Disposition", `inline; filename="check-${check.code}.png"`);
        return res.send(buffer);
    }

    @Post()
    create(@Body() dto: CreateCheckDto) {
        return this.checksService.create(dto);
    }

    @Post("use")
    useCheck(@Body() dto: UseCheckDto) {
        return this.checksService.useCheck(dto);
    }

    @Put(":id/cancel")
    cancelCheck(@Param("id", ParseIntPipe) id: number) {
        return this.checksService.cancelCheck(id);
    }

    @Put(":id/confirm")
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles("moderator", "operator")
    confirmCheck(@Param("id", ParseIntPipe) id: number) {
        return this.checksService.confirmCheck(id);
    }

    @Put(":id/reactivate")
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles("moderator", "operator")
    reactivateCheck(
        @Param("id", ParseIntPipe) id: number,
        @Body("amountLiters") amountLiters: number,
        @Body("operatorId") operatorId: number
    ) {
        return this.checksService.reactivateCheck(id, amountLiters, operatorId);
    }

    @Delete(":id")
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles("moderator")
    deleteCheck(@Param("id", ParseIntPipe) id: number) {
        return this.checksService.deleteCheck(id);
    }
}
