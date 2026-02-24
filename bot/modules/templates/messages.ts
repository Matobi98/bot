import { Markup } from 'telegraf';
import { I18nContext } from '@grammyjs/i18n';
import { IOrderTemplate } from '../../../models/order_template';

export const templatesListData = (i18n: I18nContext, templates: IOrderTemplate[]) => {
    if (templates.length === 0) {
        const text = i18n.t('no_templates');
        const keyboard = Markup.inlineKeyboard([
            Markup.button.callback(i18n.t('create_new_template'), 'tpl_list_create'),
        ]);
        return { text, keyboard };
    }

    let text = i18n.t('templates_list') + '\n\n';
    const buttons = [];

    templates.forEach((template, index) => {
        const n = index + 1;
        const typeLabel = template.type === 'buy' ? 'B' : 'S';
        const amount = template.fiat_amount.length === 2
            ? `${template.fiat_amount[0]}-${template.fiat_amount[1]}`
            : `${template.fiat_amount[0]}`;

        text += `${n}. ${typeLabel} ${template.fiat_code} ${amount} - ${template.payment_method}\n`;

        buttons.push([
            Markup.button.callback(`🚀 ${n}`, `tpl_list_publish_${template._id}`),
            Markup.button.callback(`🗑 ${n}`, `tpl_list_delete_${template._id}`),
        ]);

    });

    buttons.push([
        Markup.button.callback(i18n.t('create_new_template'), 'tpl_list_create'),
    ]);

    return { text, keyboard: Markup.inlineKeyboard(buttons) };
};

export const templateSavedMessage = (i18n: I18nContext) => {
    return i18n.t('template_saved');
};

export const templateDeletedMessage = (i18n: I18nContext) => {
    return i18n.t('template_deleted');
};

export const confirmDeleteTemplateData = (i18n: I18nContext, templateId: string) => {
    const keyboard = Markup.inlineKeyboard([
        Markup.button.callback(i18n.t('yes'), `tpl_list_confirm_delete_${templateId}`),
        Markup.button.callback(i18n.t('no'), 'tpl_list_back'),
    ]);
    return { text: i18n.t('confirm_delete_template'), keyboard };
};
