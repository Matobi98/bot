import { Scenes, Markup } from 'telegraf';
import { OrderTemplate } from '../../../models';
import { getCurrency } from '../../../util';
import { CommunityContext, CommunityWizardState } from '../community/communityContext';
import { logger } from '../../../logger';
import { createOrderWizardStatus } from '../orders/messages';
import * as templatesMessages from './messages';
import * as templatesCommands from './commands';
import { Message } from 'telegraf/typings/core/types/typegram';

export const TEMPLATES_WIZARD = 'TEMPLATES_WIZARD';

/**
 * Robust interface for Template Wizard State
 */
interface TemplateWizardState extends Scenes.WizardSessionData {
    user: any;
    creating?: boolean;
    listMessageId?: number;
    statusMessage?: Message.TextMessage;
    currentStatusText?: string;
    type?: 'buy' | 'sell';
    currency?: string;
    fiatAmount?: number[];
    priceMargin?: number;
    method?: string;
    sats?: number;
    error?: string | null;
    promptId?: number;
    isUpdatingUI?: boolean;
    updateUI?: () => Promise<void>;
}

/**
 * Helper to clean up creation-specific state
 */
const resetCreationState = (state: TemplateWizardState) => {
    delete state.creating;
    delete state.statusMessage;
    delete state.currentStatusText;
    delete state.type;
    delete state.currency;
    delete state.fiatAmount;
    delete state.priceMargin;
    delete state.method;
    delete state.sats;
    delete state.error;
    delete state.promptId;
    delete state.isUpdatingUI;
    delete state.updateUI;
};

// We define the scene first to allow middleware registration order control
export const templatesWizard = new Scenes.WizardScene<CommunityContext>(
    TEMPLATES_WIZARD,
    // Step 0: List View & Management
    async (ctx) => {
        const state = ctx.wizard.state as unknown as TemplateWizardState;

        // Ensure creation state is wiped when re-entering the list
        resetCreationState(state);

        try {
            const templates = await OrderTemplate.find({ creator_id: state.user._id });
            const { text, keyboard } = templatesMessages.templatesListData(ctx.i18n, templates);

            if (state.listMessageId) {
                try {
                    await ctx.telegram.editMessageText(
                        ctx.chat!.id,
                        state.listMessageId,
                        undefined,
                        text,
                        keyboard
                    );
                } catch (err: any) {
                    if (err.description?.includes('message is not modified')) {
                        // Ignore redundant edits
                    } else {
                        const res = await ctx.reply(text, keyboard);
                        state.listMessageId = res.message_id;
                    }
                }
            } else {
                const res = await ctx.reply(text, keyboard);
                state.listMessageId = res.message_id;
            }
            return ctx.wizard.next();
        } catch (err) {
            logger.error('Error in templates list step:', err);
            return ctx.scene.leave();
        }
    },
    // Step 1: List Handler
    async (ctx) => {
        const state = ctx.wizard.state as unknown as TemplateWizardState;

        if (ctx.callbackQuery) {
            const data = (ctx.callbackQuery as any).data as string;

            if (data === 'tpl_list_create') {
                await ctx.answerCbQuery().catch(() => { });
                // Cleanup list message to avoid confusion
                if (state.listMessageId) {
                    await ctx.telegram.deleteMessage(ctx.chat!.id, state.listMessageId).catch(() => { });
                    delete state.listMessageId;
                }
                state.creating = true;
                // MANUAL CURSOR HACK: Move to creation flow initialization
                // We use type assertion to access private cursor if needed, but selectStep is safer if available
                ctx.wizard.cursor = 2;
                return (ctx.wizard as any).steps[2](ctx);
            }

            if (data.startsWith('tpl_list_publish_')) {
                await ctx.answerCbQuery().catch(() => { });
                const id = data.replace('tpl_list_publish_', '');
                const template = await OrderTemplate.findById(id);
                if (template) {
                    await templatesCommands.publishFromTemplate(ctx as any, template);
                }
                // REFRESH LIST: Move back to Step 0
                ctx.wizard.cursor = 0;
                return (ctx.wizard as any).steps[0](ctx);
            }

            if (data.startsWith('tpl_list_delete_')) {
                await ctx.answerCbQuery().catch(() => { });
                const id = data.replace('tpl_list_delete_', '');
                const { text, keyboard } = templatesMessages.confirmDeleteTemplateData(ctx.i18n, id);
                if (state.listMessageId) {
                    await ctx.telegram.editMessageText(ctx.chat!.id, state.listMessageId, undefined, text, keyboard).catch(() => { });
                }
                return; // Wait for confirmation
            }

            if (data.startsWith('tpl_list_confirm_delete_')) {
                await ctx.answerCbQuery().catch(() => { });
                const id = data.replace('tpl_list_confirm_delete_', '');
                await OrderTemplate.deleteOne({ _id: id });
                await ctx.reply(templatesMessages.templateDeletedMessage(ctx.i18n));
                // REFRESH LIST: Move back to Step 0
                ctx.wizard.cursor = 0;
                return (ctx.wizard as any).steps[0](ctx);
            }

            if (data === 'tpl_list_back') {
                await ctx.answerCbQuery().catch(() => { });
                // REFRESH LIST: Move back to Step 0
                ctx.wizard.cursor = 0;
                return (ctx.wizard as any).steps[0](ctx);
            }
        }

        if (ctx.message) {
            await ctx.deleteMessage().catch(() => { });
        }
    },
    // Step 2: Setup Creation UI (Linear Entry)
    async (ctx) => {
        const state = ctx.wizard.state as unknown as TemplateWizardState;

        if (!state.statusMessage) {
            const { text } = createOrderWizardStatus(ctx.i18n, state as unknown as CommunityWizardState);
            const res = await ctx.reply(text);
            state.currentStatusText = text;
            state.statusMessage = res as Message.TextMessage;

            // Robust updateUI with lock to avoid race conditions
            state.updateUI = async () => {
                if (state.isUpdatingUI || !state.statusMessage) return;
                const { text: newText } = createOrderWizardStatus(ctx.i18n, state as unknown as CommunityWizardState);
                if (state.currentStatusText === newText) return;

                state.isUpdatingUI = true;
                try {
                    await ctx.telegram.editMessageText(
                        state.statusMessage.chat.id,
                        state.statusMessage.message_id,
                        undefined,
                        newText
                    );
                    state.currentStatusText = newText;
                } catch (err: any) {
                    if (!err.description?.includes('message is not modified')) {
                        logger.warn('Failed to update template status UI:', err.message);
                    }
                } finally {
                    state.isUpdatingUI = false;
                }
            };
        }

        // Show first choice
        const keyboard = Markup.inlineKeyboard([
            Markup.button.callback(ctx.i18n.t('buy'), 'tpl_type_buy'),
            Markup.button.callback(ctx.i18n.t('sell'), 'tpl_type_sell'),
        ]);
        const prompt = await ctx.reply(ctx.i18n.t('enter_template_type'), keyboard);
        state.promptId = prompt.message_id;
        return ctx.wizard.next();
    },
    // Step 3: Type Handler
    async (ctx) => {
        const state = ctx.wizard.state as unknown as TemplateWizardState;
        if (ctx.callbackQuery) {
            const data = (ctx.callbackQuery as any).data as string;
            if (!data.startsWith('tpl_type_')) return;
            await ctx.answerCbQuery().catch(() => { });
            state.type = data === 'tpl_type_buy' ? 'buy' : 'sell';

            if (state.promptId) {
                await ctx.telegram.deleteMessage(ctx.chat!.id, state.promptId).catch(() => { });
                delete state.promptId;
            }
            await state.updateUI?.();

            // Proceed to Currency
            const buttons = ['USD', 'EUR', 'ARS', 'VES', 'COP', 'BRL'].map(c =>
                Markup.button.callback(c, `tpl_cur_${c}`)
            );
            const rows = [];
            for (let i = 0; i < buttons.length; i += 3) {
                rows.push(buttons.slice(i, i + 3));
            }
            const prompt = await ctx.reply(ctx.i18n.t('choose_currency'), Markup.inlineKeyboard(rows));
            state.promptId = prompt.message_id;
            return ctx.wizard.next();
        }
        if (ctx.message) await ctx.deleteMessage().catch(() => { });
    },
    // Step 4: Currency Handler
    async (ctx) => {
        const state = ctx.wizard.state as unknown as TemplateWizardState;
        let currencyCode: string | undefined;

        if (ctx.callbackQuery) {
            const data = (ctx.callbackQuery as any).data as string;
            if (!data.startsWith('tpl_cur_')) return;
            await ctx.answerCbQuery().catch(() => { });
            currencyCode = data.replace('tpl_cur_', '');
        } else if (ctx.message && 'text' in ctx.message) {
            currencyCode = ctx.message.text.toUpperCase();
            await ctx.deleteMessage().catch(() => { });
        }

        if (!currencyCode) return;

        const currency = getCurrency(currencyCode);
        if (!currency) {
            state.error = ctx.i18n.t('invalid_currency');
            await state.updateUI?.();
            return;
        }

        state.currency = currency.code;
        state.error = null;
        if (state.promptId) {
            await ctx.telegram.deleteMessage(ctx.chat!.id, state.promptId).catch(() => { });
            delete state.promptId;
        }
        await state.updateUI?.();

        // Proceed to Amount
        const prompt = await ctx.reply(ctx.i18n.t('enter_currency_amount', { currency: state.currency }));
        state.promptId = prompt.message_id;
        return ctx.wizard.next();
    },
    // Step 5: Amount Handler
    async (ctx) => {
        const state = ctx.wizard.state as unknown as TemplateWizardState;
        if (!ctx.message || !('text' in ctx.message)) return;
        const text = ctx.message.text;
        await ctx.deleteMessage().catch(() => { });

        const inputs = text.split('-').map(Number);
        if (inputs.some(isNaN) || inputs.length > 2) {
            state.error = ctx.i18n.t('must_be_number_or_range');
            await state.updateUI?.();
            return;
        }

        state.fiatAmount = inputs;
        state.error = null;
        if (state.promptId) {
            await ctx.telegram.deleteMessage(ctx.chat!.id, state.promptId).catch(() => { });
            delete state.promptId;
        }
        await state.updateUI?.();

        // Market price default for templates
        state.sats = 0;

        // Proceed to Margin
        const margin = ['-5', '-4', '-3', '-2', '-1', '+1', '+2', '+3', '+4', '+5'];
        const buttons = margin.map(m => Markup.button.callback(m + '%', `tpl_margin_${m}`));
        const rows = [];
        for (let i = 0; i < buttons.length; i += 5) {
            rows.push(buttons.slice(i, i + 5));
        }
        rows.push([Markup.button.callback(ctx.i18n.t('no_premium_or_discount'), 'tpl_margin_0')]);
        const prompt = await ctx.reply(ctx.i18n.t('enter_premium_discount'), Markup.inlineKeyboard(rows));
        state.promptId = prompt.message_id;
        return ctx.wizard.next();
    },
    // Step 6: Margin Handler
    async (ctx) => {
        const state = ctx.wizard.state as unknown as TemplateWizardState;
        let marginText: string | undefined;

        if (ctx.callbackQuery) {
            const data = (ctx.callbackQuery as any).data as string;
            if (!data.startsWith('tpl_margin_')) return;
            await ctx.answerCbQuery().catch(() => { });
            marginText = data.replace('tpl_margin_', '');
        } else if (ctx.message && 'text' in ctx.message) {
            marginText = ctx.message.text;
            await ctx.deleteMessage().catch(() => { });
        }

        if (marginText === undefined) return;

        const marginVal = parseInt(marginText);
        if (isNaN(marginVal)) {
            state.error = ctx.i18n.t('not_number');
            await state.updateUI?.();
            return;
        }

        state.priceMargin = marginVal;
        state.error = null;
        if (state.promptId) {
            await ctx.telegram.deleteMessage(ctx.chat!.id, state.promptId).catch(() => { });
            delete state.promptId;
        }
        await state.updateUI?.();

        // Proceed to Method
        const prompt = await ctx.reply(ctx.i18n.t('enter_payment_method'));
        state.promptId = prompt.message_id;
        return ctx.wizard.next();
    },
    // Step 7: Method Handler & Completion
    async (ctx) => {
        const state = ctx.wizard.state as unknown as TemplateWizardState;
        if (!ctx.message || !('text' in ctx.message)) return;
        const text = ctx.message.text;
        await ctx.deleteMessage().catch(() => { });

        state.method = text;
        if (state.promptId) {
            await ctx.telegram.deleteMessage(ctx.chat!.id, state.promptId).catch(() => { });
            delete state.promptId;
        }
        await state.updateUI?.();

        // Finalize
        try {
            const templateData = {
                creator_id: state.user._id,
                type: state.type,
                fiat_code: state.currency,
                fiat_amount: state.fiatAmount,
                payment_method: state.method,
                price_from_api: true,
                price_margin: state.priceMargin,
            };
            const template = new OrderTemplate(templateData);
            await template.save();

            if (state.statusMessage) {
                await ctx.telegram.deleteMessage(ctx.chat!.id, state.statusMessage.message_id).catch(() => { });
            }
            await ctx.reply(templatesMessages.templateSavedMessage(ctx.i18n));
        } catch (err) {
            logger.error('Failed to save template:', err);
            await ctx.reply(ctx.i18n.t('generic_error'));
        }

        // Return to the list view
        resetCreationState(state);
        ctx.wizard.cursor = 0;
        return (ctx.wizard as any).steps[0](ctx);
    }
);

/**
 * CRITICAL: Middleware registered to intercept commands.
 *
 * We block all commands EXCEPT:
 *   - /exit and /help (handled explicitly)
 *   - /templates and /publishtemplate (allowed to pass so they don't loop on entry)
 *
 * This ensures that if the user types /sell while looking at the templates list,
 * they get the "wizard help" message and the message is deleted.
 */
templatesWizard.use(async (ctx, next) => {
    if (ctx.message && 'text' in ctx.message && ctx.message.text.startsWith('/')) {
        const text = ctx.message.text;
        const state = ctx.wizard.state as unknown as TemplateWizardState;

        if (text === '/exit') {
            // Clean up any persistent UI elements before leaving
            if (state.statusMessage) {
                await ctx.telegram.deleteMessage(ctx.chat!.id, state.statusMessage.message_id).catch(() => { });
            }
            if (state.promptId) {
                await ctx.telegram.deleteMessage(ctx.chat!.id, state.promptId).catch(() => { });
            }
            if (state.listMessageId) {
                await ctx.telegram.deleteMessage(ctx.chat!.id, state.listMessageId).catch(() => { });
            }
            await ctx.scene.leave();
            return ctx.reply(ctx.i18n.t('wizard_exit'));
        }

        if (text === '/help') {
            return ctx.reply(ctx.i18n.t('wizard_help'));
        }

        // Allow entry commands to avoid infinite loop on scene enter
        if (text === '/templates' || text === '/publishtemplate') {
            return next();
        }

        // Block all other commands and notify the user
        await ctx.reply(ctx.i18n.t('wizard_help'));
        await ctx.deleteMessage().catch(() => { });
        return;
    }
    return next();
});


