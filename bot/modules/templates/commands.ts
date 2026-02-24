import { OrderTemplate } from '../../../models';
import * as ordersActions from '../../ordersActions';
import * as messages from './messages';
import { publishBuyOrderMessage, publishSellOrderMessage, tooManyPendingOrdersMessage } from '../../messages';
import { MainContext, HasTelegram } from '../../start';
import { isMaxPending } from '../orders/commands';
import { logger } from '../../../logger';

export const listTemplates = async (ctx: MainContext) => {
    try {
        const templates = await OrderTemplate.find({ creator_id: ctx.user._id });
        const { text, keyboard } = messages.templatesListData(ctx.i18n, templates);
        await ctx.reply(text, keyboard);
    } catch (error) {
        logger.error(error);
    }
};

export const publishtemplate = async (ctx: MainContext) => {
    try {
        const params = (ctx.update as any).message.text.split(' ');
        const [command, nStr] = params.filter((el: string) => el);

        if (!nStr) {
            return listTemplates(ctx);
        }

        const n = parseInt(nStr);
        if (isNaN(n)) return;

        const templates = await OrderTemplate.find({ creator_id: ctx.user._id });
        const template = templates[n - 1];

        if (!template) {
            return ctx.reply(ctx.i18n.t('template_not_found'));
        }

        await publishFromTemplate(ctx, template);
    } catch (error) {
        logger.error(error);
    }
};

export const publishFromTemplate = async (ctx: MainContext, template: any) => {
    try {
        const user = ctx.user;
        if (await isMaxPending(user)) {
            return await tooManyPendingOrdersMessage(ctx, user, ctx.i18n);
        }

        const order = await ordersActions.createOrder(ctx.i18n, ctx as any as HasTelegram, user, {
            type: template.type,
            amount: 0, // templates currently support only market price (API)
            fiatAmount: template.fiat_amount,
            fiatCode: template.fiat_code,
            paymentMethod: template.payment_method,
            status: 'PENDING',
            priceMargin: template.price_margin,
            community_id: user.default_community_id,
        });

        if (order) {
            const publishFn = template.type === 'buy' ? publishBuyOrderMessage : publishSellOrderMessage;
            await publishFn(ctx as any, user, order, ctx.i18n, true);
            // Success message is usually handled by the publishFn sending to channel/user
            // But we can add a little confirmation if needed.
        }
    } catch (error) {
        logger.error(error);
        await ctx.reply(ctx.i18n.t('generic_error'));
    }
};

export const deleteTemplate = async (ctx: MainContext, templateId: string) => {
    try {
        const template = await OrderTemplate.findOne({ _id: templateId, creator_id: ctx.user._id });
        if (!template) return;
        await OrderTemplate.deleteOne({ _id: templateId });
        await ctx.reply(messages.templateDeletedMessage(ctx.i18n));
        await listTemplates(ctx);

    } catch (error) {
        logger.error(error);
    }
};
