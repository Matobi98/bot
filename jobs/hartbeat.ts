import { Telegraf } from 'telegraf';
import { CommunityContext } from '../bot/modules/community/communityContext';
import { logger } from '../logger';
import mongoose, { Mongoose } from 'mongoose';
const { getInfo } = require('../ln');

const hartbeat = async (bot: Telegraf<CommunityContext>) => {
    let message = '';
    try {
        const info = await getInfo();
        const mongoOk = mongoose.connection.readyState === 1;
        const status = {
            mongodb: mongoOk ? 'OK' : 'ERROR',
            lnd: info ? 'OK' : 'ERROR',
            bot: (info && mongoOk) ? 'OK' : 'ERROR'
        }
        message = JSON.stringify(status);
    } catch (error) {
        const errorMsg = String(error);
        logger.error(`hartbeat catch error: ${errorMsg}`);
        message = JSON.stringify({
            mongodb: 'ERROR',
            LND: 'ERROR',
            bot: 'ERROR'
        });
    }
    await bot.telegram.sendMessage(process.env.HARTBEAT_GROUP!, message);
};

export default hartbeat;