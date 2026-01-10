import { Update, Ctx, Start, Hears, On, Message } from "nestjs-telegraf";
import { Context, Markup } from "telegraf";
import { BotService } from "./bot.service";

interface SessionData {
    step?: "awaiting_phone" | "awaiting_name" | "awaiting_code" | "main_menu";
    pendingCheckCode?: string;
    phone?: string;
}

interface SessionContext extends Context {
    session?: SessionData;
}

const userSessions = new Map<string, SessionData>();
const pendingChecks = new Map<string, string>();

@Update()
export class BotUpdate {
    constructor(private botService: BotService) { }

    private mainMenu = Markup.keyboard([
        ["📱 Chek kiritish"],
        ["👤 Mening profilim"],
        ["📊 Statistika"],
        ["ℹ️ Yordam"],
    ]).resize();

    private backMenu = Markup.keyboard([["🔙 Orqaga"]]).resize();

    private phoneMenu = Markup.keyboard([
        [Markup.button.contactRequest("📞 Telefon raqamni yuborish")],
    ]).resize().oneTime();

    @Start()
    async onStart(@Ctx() ctx: SessionContext) {
        const telegramId = ctx.from?.id.toString();
        if (!telegramId) {
            await ctx.reply("Xatolik yuz berdi.");
            return;
        }

        const payload = (ctx as any).startPayload;
        const user = await this.botService.findUserByTelegramId(telegramId);

        if (!user) {
            if (payload && payload.startsWith("check_")) {
                const checkCode = payload.replace("check_", "");
                pendingChecks.set(telegramId, checkCode);
                await ctx.reply(
                    "🎉 *NBS Gaz Oil bonusli loyihasi botiga xush kelibsiz!*\n\n⚠️ Chekni ishlatish uchun avval ro'yxatdan o'ting.\n\nTelefon raqamingizni yuboring:",
                    { parse_mode: "Markdown", reply_markup: this.phoneMenu.reply_markup }
                );
                return;
            }
            await ctx.reply(
                "🎉 *NBS Gaz Oil bonusli loyihasi botiga xush kelibsiz!*\n\n⚠️ Chekni ishlatish uchun avval ro'yxatdan o'ting.\n\nTelefon raqamingizni yuboring:",
                { parse_mode: "Markdown", reply_markup: this.phoneMenu.reply_markup }
            );
            return;
        }

        if (payload && payload.startsWith("check_")) {
            const checkCode = payload.replace("check_", "");
            await ctx.reply("⏳ Chek tekshirilmoqda...");
            await this.processCheckCode(ctx, user, checkCode);
            return;
        }

        await ctx.reply(
            `👋 *Xush kelibsiz, ${user.fullName || "Mijoz"}!*\n\n💧 Balans: *${user.balanceLiters} litr*`,
            { parse_mode: "Markdown", reply_markup: this.mainMenu.reply_markup }
        );
    }

    @On("contact")
    async onContact(@Ctx() ctx: SessionContext, @Message() msg: any) {
        const telegramId = ctx.from?.id.toString();
        const phone = msg.contact?.phone_number;
        const telegramUsername = ctx.from?.username;

        if (!telegramId || !phone) return;

        const existingUser = await this.botService.findUserByTelegramId(telegramId);
        if (existingUser) {
            await ctx.reply("Siz allaqachon ro'yxatdan o'tgansiz!", { reply_markup: this.mainMenu.reply_markup });
            return;
        }

        const existingByPhone = await this.botService.findUserByPhone(phone);
        if (existingByPhone && existingByPhone.telegramId !== telegramId) {
            await ctx.reply("❌ Bu telefon raqam boshqa hisobga biriktirilgan.");
            return;
        }

        // Telefon raqamni saqlash va ism so'rash
        const session: SessionData = {
            step: "awaiting_name",
            phone,
            pendingCheckCode: pendingChecks.get(telegramId),
        };
        userSessions.set(telegramId, session);

        await ctx.reply(
            "📝 *Ism va familiyangizni kiriting:*\n\nMasalan: Shahriyor Zaripov",
            { parse_mode: "Markdown", reply_markup: { remove_keyboard: true } }
        );
    }

    @Hears("📱 Chek kiritish")
    async onCheckInput(@Ctx() ctx: SessionContext) {
        await ctx.reply("🔢 *Chek kodini kiriting:*", {
            parse_mode: "Markdown",
            reply_markup: this.backMenu.reply_markup,
        });
    }

    @Hears("👤 Mening profilim")
    async onProfile(@Ctx() ctx: SessionContext) {
        const telegramId = ctx.from?.id.toString();
        if (!telegramId) return;

        const user = await this.botService.getUserProfile(telegramId);
        if (!user) {
            await ctx.reply("Iltimos, /start buyrug'ini yuboring.");
            return;
        }

        await ctx.reply(
            `👤 *Profil*\n\n📛 ${user.fullName || "Noma'lum"}\n📞 ${user.phone || "-"}\n💧 *${user.balanceLiters} litr*\n📝 ${user.checksCount} chek`,
            { parse_mode: "Markdown", reply_markup: this.mainMenu.reply_markup }
        );
    }

    @Hears("📊 Statistika")
    async onStats(@Ctx() ctx: SessionContext) {
        const telegramId = ctx.from?.id.toString();
        if (!telegramId) return;

        const stats = await this.botService.getUserStats(telegramId);
        if (!stats) {
            await ctx.reply("Iltimos, /start buyrug'ini yuboring.");
            return;
        }

        await ctx.reply(
            `📊 *Statistika*\n\n📅 Bu oy: ${stats.monthlyChecks} chek, ${stats.monthlyLiters} L\n💧 Balans: *${stats.balance} litr*`,
            { parse_mode: "Markdown", reply_markup: this.mainMenu.reply_markup }
        );
    }

    @Hears("ℹ️ Yordam")
    async onHelp(@Ctx() ctx: SessionContext) {
        await ctx.reply(
            "ℹ️ *Yordam*\n\n📱 Chek kiritish - Kod kiritib litr yig'ing\n👤 Profil - Balans ko'ring\n📊 Statistika - Oylik ma'lumotlar\n\nUshbu bot @webgradeuz tomonidan ishlab chiqilgan.",
            { parse_mode: "Markdown", reply_markup: this.mainMenu.reply_markup }
        );
    }

    @Hears("🔙 Orqaga")
    async onBack(@Ctx() ctx: SessionContext) {
        await ctx.reply("Asosiy menyu:", { reply_markup: this.mainMenu.reply_markup });
    }

    @On("text")
    async onText(@Ctx() ctx: SessionContext, @Message() msg: any) {
        const text = msg.text;
        if (!text || text.startsWith("/") || text.startsWith("📱") || text.startsWith("👤") || text.startsWith("📊") || text.startsWith("ℹ️") || text.startsWith("🔙")) {
            return;
        }

        const telegramId = ctx.from?.id.toString();
        if (!telegramId) return;

        // Ism kutilayotgan bo'lsa
        const session = userSessions.get(telegramId);
        if (session?.step === "awaiting_name" && session.phone) {
            const fullName = text.trim();
            if (fullName.length < 3) {
                await ctx.reply("❌ Ism juda qisqa. Iltimos, to'liq ism va familiyangizni kiriting.");
                return;
            }

            const telegramUsername = ctx.from?.username;
            const user = await this.botService.createUser({
                telegramId,
                telegramUsername,
                fullName,
                phone: session.phone,
            });

            userSessions.delete(telegramId);

            if (session.pendingCheckCode) {
                pendingChecks.delete(telegramId);
                await ctx.reply(
                    `✅ *Ro'yxatdan o'tdingiz!*\n\n👤 ${user.fullName}\n📞 ${user.phone}`,
                    { parse_mode: "Markdown" }
                );
                await ctx.reply("⏳ Chek tekshirilmoqda...");
                await this.processCheckCode(ctx, user, session.pendingCheckCode);
                return;
            }

            await ctx.reply(
                `✅ *Ro'yxatdan o'tdingiz!*\n\n👤 ${user.fullName}\n📞 ${user.phone}\n💧 Balans: 0 litr`,
                { parse_mode: "Markdown", reply_markup: this.mainMenu.reply_markup }
            );
            return;
        }

        const user = await this.botService.findUserByTelegramId(telegramId);
        if (!user) {
            await ctx.reply("Iltimos, /start buyrug'ini yuboring.");
            return;
        }

        await this.processCheckCode(ctx, user, text);
    }

    private async processCheckCode(ctx: Context, user: any, code: string): Promise<void> {
        const result = await this.botService.useCheck(code.toUpperCase().trim(), user.id);

        if (!result.success) {
            await ctx.reply(`❌ *${result.message}*`, { parse_mode: "Markdown" });
            return;
        }

        await ctx.reply(
            `✅ *Chek qabul qilindi!*\n\n💧 +${result.amount} litr\n🏪 ${result.stationName}\n💰 Balans: *${result.newBalance} litr*`,
            { parse_mode: "Markdown", reply_markup: this.mainMenu.reply_markup }
        );
    }
}
