// 角色的中文名（照 Plasticine-bot 的中文名表，MIT）：挑头像时读屏念、悬停提示。单字的改成两个字（「蛋」→「鸡蛋」），
// 界面命名不用单字（11-08 Aaron 定）。

import type { MateCharacter } from '../../../api/shared.ts';

export const CHARACTER_NAMES: Readonly<Record<MateCharacter, string>> = {
  circle: '圆形', mochi: '麻薯', blob: '果冻', pebble: '石子', egg: '鸡蛋', bun: '包子',
  tofu: '豆腐', pill: '胶囊',
  hex: '六边', onigiri: '饭团', gem: '宝石',
  cloud: '云朵', drop: '水滴', leaf: '叶子', flower: '小花', clover: '四叶草',
  sprout: '豆芽', mushroom: '蘑菇', acorn: '橡果', cactus: '仙人掌', eggplant: '茄子',
  pear: '梨子', apple: '苹果', strawberry: '草莓', cherry: '樱桃', avocado: '牛油果', melon: '西瓜',
  pudding: '布丁', toast: '吐司', icecream: '冰淇淋', cupcake: '纸杯蛋糕', fries: '薯条', candy: '糖果', burger: '汉堡',
  star: '星星', heart: '爱心', flame: '火苗', bell: '铃铛', ghost: '幽灵', bot: '机器人', crescent: '月牙',
  boba: '奶茶', planet: '星球',
  cottage: '小屋', chat: '对话气泡', gift: '礼物', bulb: '灯泡',
  fish: '小鱼', octopus: '章鱼', seal: '海豹', puffer: '河豚',
  cat: '猫咪', bunny: '兔子', bear: '小熊', chick: '小鸡', penguin: '企鹅', pig: '小猪', fox: '狐狸', lion: '狮子',
  hamster: '仓鼠', hedgehog: '刺猬', koala: '考拉', bat: '蝙蝠',
  bob: '波波头', topknot: '丸子头', spiky: '刺头', curly: '卷毛', twinbuns: '双丸子',
  chunk: '煤块', lump: '煤球', fluff: '煤灰团',
};
