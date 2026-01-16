import { IsString, IsOptional, IsEnum, IsNumber, IsBoolean } from "class-validator";
import { Role } from "@prisma/client";
import { Type } from "class-transformer";

export class CreateUserDto {
    @IsString()
    @IsOptional()
    username?: string;

    @IsString()
    @IsOptional()
    password?: string;

    @IsString()
    @IsOptional()
    fullName?: string;

    @IsString()
    @IsOptional()
    phone?: string;

    @IsString()
    @IsOptional()
    telegramId?: string;

    @IsString()
    @IsOptional()
    telegramUsername?: string;

    @IsEnum(Role)
    @IsOptional()
    role?: Role;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    stationId?: number;
}

export class UpdateUserDto {
    @IsString()
    @IsOptional()
    fullName?: string;

    @IsString()
    @IsOptional()
    phone?: string;

    @IsString()
    @IsOptional()
    password?: string;

    @IsBoolean()
    @IsOptional()
    isActive?: boolean;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    stationId?: number;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    balanceLiters?: number;
}
