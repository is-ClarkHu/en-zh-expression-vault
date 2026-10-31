#!/usr/bin/env node
// Builds data/sample/vault.json: the public demo vault. Every entry below is
// hand-written SYNTHETIC data, not anyone's captured vocabulary. Output matches
// db.exportVault()'s shape and the normalizeRow() field set, so Settings →
// Sync & data → Load sample vault imports it like any export.
//
//   node tools/make-sample-vault.mjs            # write + embed (OPENAI_API_KEY)
//   node tools/make-sample-vault.mjs --no-embed # write without embeddings
//
// Embeddings use text-embedding-3-small on `surface — gloss_cn`, the same text
// reassign/index.js:25 embeds, so the demo graph behaves like a real vault.
// typed edges are derived from each card's `relations` where both ends are in
// the vault, written in the app's own `${from}~${to}~${type}` id format.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data/sample/vault.json");
const DAY = 86_400_000;

// rel helpers: [type, surface, register, common]
const ab = (surface, register, common = false) => ({ type: "abbreviation", surface, register, common });
const ant = (surface, register) => ({ type: "antonym", surface, register, common: false });
const syn = (surface, register) => ({ type: "synonym", surface, register, common: false });

// s surface · p pos · r reading · g register · c corpus · t topics · i intents ·
// gl gloss_cn · ic intent_cn · ex example_src · ep example_parallel ·
// rel relations · sk sense_key · k kind · n note · qa qa_log
const WORDS = [
  // kitchen
  { s: "peeler", p: "noun", r: "/ˈpiːlər/", g: "neutral", t: ["kitchen"], i: ["name-household-item"], gl: "削皮刀（刨土豆皮那种）", ic: "说削皮的小工具", ex: "Can you pass me the peeler? These carrots are filthy.", ep: "Grab the peeler from the second drawer. — 削皮刀在第二个抽屉。" },
  { s: "ladle", p: "noun", r: "/ˈleɪdəl/", g: "neutral", t: ["kitchen"], i: ["name-household-item"], gl: "汤勺，长柄大勺", ic: "说舀汤的大勺", ex: "Use the ladle, not a mug, to serve the soup.", ep: "The ladle's in the dishwasher. — 汤勺在洗碗机里。" },
  { s: "colander", p: "noun", r: "/ˈkɑːləndər/", g: "neutral", t: ["kitchen"], i: ["name-household-item"], gl: "沥水篮，洗菜沥面用的", ic: "说沥水的篮子", ex: "Dump the pasta into the colander.", ep: "Rinse the berries in a colander. — 用沥水篮冲一下莓子。" },
  { s: "zest", p: "verb", r: "/zɛst/", g: "neutral", t: ["in-the-kitchen"], i: ["talk-food"], gl: "刮柠檬皮屑（只刮黄色那层）", ic: "说刮果皮屑", ex: "Zest the lemon before you juice it.", ep: "Don't zest too deep, the white part is bitter. — 别刮太深，白色那层是苦的。" },
  { s: "simmer", p: "verb", r: "/ˈsɪmər/", g: "neutral", t: ["in-the-kitchen"], i: ["talk-food"], gl: "小火慢炖，冒小泡但不滚", ic: "说小火炖着", ex: "Let it simmer for twenty minutes.", ep: "Bring it to a boil, then let it simmer. — 先烧开再转小火炖。" },
  { s: "mince", p: "verb", r: "/mɪns/", g: "neutral", t: ["in-the-kitchen"], i: ["talk-food"], gl: "剁碎、切末（蒜末那种）", ic: "说把东西切成末", ex: "Mince two cloves of garlic.", ep: "Mince the garlic as fine as you can. — 蒜尽量剁细。" },
  { s: "backed-up sink", p: "phrase", g: "casual", t: ["kitchen"], i: ["describe-problem"], gl: "水槽堵了，水下不去", ic: "说水槽堵住排不了水", ex: "The kitchen sink is backed up again.", ep: "Don't pour grease down there, the sink'll back up. — 别往里倒油，水槽会堵。", rel: [syn("clogged drain", "neutral")] },
  // home repair
  { s: "clogged drain", p: "phrase", g: "neutral", t: ["home-repair"], i: ["describe-problem"], gl: "下水道堵了", ic: "说下水道堵塞", ex: "We've got a clogged drain in the shower.", ep: "Hair is the number one cause of a clogged drain. — 头发是下水道堵的头号原因。", rel: [syn("backed-up sink", "casual")] },
  { s: "plunger", p: "noun", r: "/ˈplʌndʒər/", g: "neutral", t: ["home-repair"], i: ["name-household-item"], gl: "马桶搋子", ic: "说通马桶的搋子", ex: "Do we even own a plunger?", ep: "Grab the plunger, the toilet's clogged. — 拿搋子来，马桶堵了。" },
  { s: "leaky faucet", p: "phrase", g: "neutral", t: ["home-repair"], i: ["describe-problem"], gl: "关不紧一直滴水的水龙头", ic: "说水龙头在滴水", ex: "That leaky faucet kept me up all night.", ep: "Text the landlord about the leaky faucet. — 跟房东说一下水龙头漏水。" },
  { s: "trip the breaker", p: "phrase", g: "casual", t: ["home-repair"], i: ["describe-problem"], gl: "跳闸（空气开关跳了）", ic: "说电路跳闸", ex: "Running the microwave and the heater together trips the breaker.", ep: "The breaker tripped, so the whole kitchen is dark. — 跳闸了，厨房全黑。" },
  { s: "drywall anchor", p: "noun", g: "neutral", t: ["home-repair"], i: ["name-household-item"], gl: "石膏板墙用的膨胀钉（挂东西用）", ic: "说墙上挂东西用的膨胀钉", ex: "You'll need a drywall anchor for a mirror that heavy.", ep: "The shelf fell because I skipped the drywall anchors. — 架子掉了，因为没打膨胀钉。" },
  { s: "drill", sk: "drill:tool", p: "noun", r: "/drɪl/", g: "neutral", t: ["home-repair"], i: ["name-household-item"], gl: "电钻", ic: "说打孔的电钻", ex: "Can I borrow your drill this weekend?", ep: "Charge the drill before you start. — 先把电钻充上电。" },
  { s: "grout", p: "noun", r: "/ɡraʊt/", g: "neutral", t: ["cleaning", "home-repair"], i: ["name-household-item"], gl: "瓷砖缝里的填缝剂", ic: "说瓷砖缝", ex: "The grout in the shower is turning black.", ep: "Scrub the grout with an old toothbrush. — 用旧牙刷刷瓷砖缝。" },
  // cleaning
  { s: "lint roller", p: "noun", g: "neutral", t: ["cleaning"], i: ["name-household-item"], gl: "粘毛滚筒（粘衣服上的猫毛）", ic: "说粘毛器", ex: "I keep a lint roller in my car for the cat hair.", ep: "Hit your coat with the lint roller. — 用粘毛器滚一下外套。" },
  { s: "dust bunny", p: "noun", g: "casual", t: ["cleaning"], i: ["tidy-up"], gl: "床底下一团一团的灰球", ic: "说角落里的积灰团", ex: "There are dust bunnies the size of my fist under the bed.", ep: "Found three dust bunnies and a sock under the couch. — 沙发底下扫出三团灰和一只袜子。" },
  { s: "declutter", p: "verb", r: "/diːˈklʌtər/", g: "neutral", t: ["cleaning"], i: ["tidy-up"], gl: "断舍离，把多余的东西清掉", ic: "说清理杂物", ex: "I spent Sunday decluttering my closet.", ep: "Time to declutter, I can't close this drawer. — 该断舍离了，抽屉都关不上了。" },
  { s: "deep clean", p: "noun", g: "neutral", t: ["cleaning"], i: ["tidy-up"], gl: "大扫除，连犄角旮旯一起彻底打扫", ic: "说彻底打扫一遍", ex: "The apartment needs a deep clean before we move out.", ep: "We do a deep clean every spring. — 我们每年春天大扫除一次。" },
  // gadgets
  { s: "screen protector", p: "noun", g: "neutral", t: ["gadgets"], i: ["name-household-item"], gl: "手机贴膜、钢化膜", ic: "说手机贴膜", ex: "My screen protector cracked but the screen is fine.", ep: "Get a screen protector before you drop it. — 摔之前先贴个膜。" },
  { s: "charging brick", p: "noun", g: "casual", t: ["gadgets"], i: ["name-household-item"], gl: "充电头（插墙的那块）", ic: "说充电头", ex: "I have the cable but forgot the charging brick.", ep: "Can I borrow your charging brick? — 借我一下充电头？" },
  { s: "dongle", p: "noun", r: "/ˈdɑːŋɡəl/", g: "casual", t: ["gadgets"], i: ["name-household-item"], gl: "转接头（Type-C 转 HDMI 那种）", ic: "说电脑转接头", ex: "You need a dongle to plug that into a MacBook.", ep: "I own more dongles than cables now. — 我现在转接头比线还多。" },
  { s: "bricked", p: "adjective", r: "/brɪkt/", g: "slang", t: ["gadgets"], i: ["describe-problem"], gl: "（设备）变砖了，彻底开不了机", ic: "说设备坏到开不了机", ex: "The update failed and my phone is bricked.", ep: "Don't unplug it mid-update or it'll get bricked. — 更新到一半别拔，会变砖。" },
  { s: "glitchy", p: "adjective", r: "/ˈɡlɪtʃi/", g: "casual", t: ["gadgets"], i: ["describe-problem"], gl: "老出小毛病、时不时抽风", ic: "说东西时不时出故障", ex: "The app's been glitchy since the update.", ep: "My screen gets glitchy when it's cold. — 天一冷我屏幕就抽风。" },
  // injury
  { s: "twist one's ankle", p: "phrase", g: "neutral", t: ["injury"], i: ["describe-injury"], gl: "崴脚", ic: "说崴了脚", ex: "I twisted my ankle stepping off the curb.", ep: "Careful on those stairs, you'll twist your ankle. — 楼梯小心，别崴了脚。" },
  { s: "pull a muscle", p: "phrase", g: "neutral", t: ["injury", "gym"], i: ["describe-injury"], gl: "拉伤肌肉", ic: "说肌肉拉伤", ex: "I think I pulled a muscle in my back.", ep: "Warm up first or you'll pull something. — 先热身，不然会拉伤。" },
  { s: "stiff neck", p: "phrase", g: "neutral", t: ["injury"], i: ["describe-injury"], gl: "落枕、脖子僵转不动", ic: "说脖子僵硬", ex: "I slept funny and woke up with a stiff neck.", ep: "Stiff neck again? Your pillow's too high. — 又落枕了？枕头太高了。" },
  { s: "charley horse", p: "noun", g: "casual", t: ["injury"], i: ["describe-injury"], gl: "腿抽筋（半夜小腿那种）", ic: "说腿抽筋", ex: "I got a charley horse in the middle of the night.", ep: "Stretch your calf when you get a charley horse. — 抽筋了就拉伸小腿。", n: "美式口语，英国人基本不这么说", qa: [{ q: "charley horse 为什么叫这个名字？正式场合能用吗？", a: "来源说法不一，跟棒球场上的跛脚老马有关。它是美式口语，跟医生说可以直接用 a cramp in my calf。" }] },
  { s: "pins and needles", p: "idiom", g: "casual", t: ["injury"], i: ["describe-injury"], gl: "（手脚）发麻，像针扎", ic: "说手脚麻了", ex: "My foot's all pins and needles from sitting cross-legged.", ep: "I've got pins and needles in my hand. — 我手麻了。" },
  // gym
  { s: "reps", p: "noun", r: "/rɛps/", g: "casual", t: ["gym-talk"], i: ["talk-training"], gl: "（一组动作的）次数", ic: "说训练次数", ex: "Do three sets of ten reps.", ep: "Last two reps, push! — 最后两个，顶住！", rel: [ab("repetitions", "neutral")] },
  { s: "bis", p: "noun", r: "/baɪz/", g: "slang", t: ["gym"], i: ["describe-body"], gl: "二头肌（biceps 的简称）", ic: "说二头肌", ex: "Chest and bis today.", ep: "Bis and tris on Friday. — 周五练二头三头。", rel: [ab("biceps", "neutral", true)] },
  { s: "biceps", p: "noun", r: "/ˈbaɪsɛps/", g: "neutral", t: ["gym"], i: ["describe-body"], gl: "肱二头肌", ic: "说上臂前侧的肌肉", ex: "Curls mostly work your biceps.", ep: "He flexed his biceps for the photo. — 他拍照时秀了一下二头肌。", rel: [ab("bis", "slang")] },
  { s: "sesh", p: "noun", r: "/sɛʃ/", g: "slang", t: ["gym-talk"], i: ["talk-training"], gl: "一次训练（session 的简称）", ic: "说练一次", ex: "Great sesh today, legs are dead.", ep: "Quick sesh before work? — 上班前练一会儿？", rel: [ab("session", "neutral", true)] },
  { s: "PR", sk: "PR:gym", p: "abbreviation", r: "/ˌpiːˈɑːr/", g: "casual", t: ["gym-talk"], i: ["talk-training"], gl: "个人最好成绩（personal record）", ic: "说破了个人纪录", ex: "Hit a new deadlift PR today.", ep: "That's a PR by ten pounds! — 比之前最好成绩多了十磅！", rel: [ab("personal record", "neutral")] },
  { s: "personal record", p: "phrase", g: "neutral", t: ["gym-talk"], i: ["talk-training"], gl: "个人最好成绩", ic: "说个人最高纪录", ex: "She set a personal record in the 5K.", ep: "Beating your personal record takes patience. — 破个人纪录要耐心。", rel: [ab("PR", "casual", true)] },
  { s: "buff", sk: "buff:gym", p: "adjective", r: "/bʌf/", g: "casual", t: ["gym"], i: ["describe-body"], gl: "壮，肌肉练得很明显", ic: "夸人身材壮", ex: "He got really buff over the summer.", ep: "You're looking buff these days! — 最近练得挺壮啊！", rel: [ant("scrawny", "casual")] },
  { s: "scrawny", p: "adjective", r: "/ˈskrɔːni/", g: "casual", t: ["gym"], i: ["describe-body"], gl: "瘦得皮包骨、干巴巴的", ic: "说人瘦小没肉", ex: "I was a scrawny kid until college.", ep: "Don't call him scrawny, he's touchy about it. — 别说他瘦猴，他介意。", rel: [ant("buff", "casual")] },
  { s: "get shredded", p: "phrase", g: "slang", t: ["gym"], i: ["describe-body"], gl: "练到体脂很低、肌肉线条分明", ic: "说练出肌肉线条", ex: "He's trying to get shredded for summer.", ep: "Cutting carbs to get shredded. — 为了练出线条在减碳水。" },
  // food
  { s: "leftovers", p: "noun", r: "/ˈlɛftˌoʊvərz/", g: "neutral", t: ["food"], i: ["talk-food"], gl: "剩菜", ic: "说吃剩的饭菜", ex: "I'm just having leftovers for lunch.", ep: "Leftover pizza is better cold. — 剩披萨凉着吃更香。" },
  { s: "hangry", p: "adjective", r: "/ˈhæŋɡri/", g: "slang", t: ["food", "mood"], i: ["describe-feeling"], gl: "饿到暴躁（hungry + angry）", ic: "说饿得发火", ex: "Feed me before I get hangry.", ep: "Sorry I snapped, I was hangry. — 抱歉凶你了，饿急眼了。" },
  { s: "takeout", p: "noun", r: "/ˈteɪkaʊt/", g: "neutral", t: ["food"], i: ["talk-food"], gl: "外卖、打包带走的饭", ic: "说点外卖", ex: "Let's just get takeout tonight.", ep: "Thai takeout again? — 又点泰餐外卖？" },
  { s: "salty", sk: "salty:taste", p: "adjective", r: "/ˈsɔːlti/", g: "neutral", t: ["food"], i: ["talk-food"], gl: "咸", ic: "说味道太咸", ex: "The soup is way too salty.", ep: "Go easy on the soy sauce, it's already salty. — 酱油少放，已经够咸了。" },
  { s: "bass", sk: "bass:fish", p: "noun", r: "/bæs/", g: "neutral", t: ["food"], i: ["talk-food"], gl: "鲈鱼（读 /bæs/）", ic: "说鲈鱼", ex: "We grilled some sea bass for dinner.", ep: "Pan-seared bass with lemon. — 香煎柠檬鲈鱼。", n: "和音乐的 bass 拼写一样，读音不同" },
  // shopping
  { s: "self-checkout", p: "noun", g: "neutral", t: ["shopping"], i: ["talk-money"], gl: "超市自助结账", ic: "说自助收银", ex: "The self-checkout keeps saying there's an unexpected item in the bagging area.", ep: "Self-checkout is faster if you only have a few things. — 东西少走自助结账更快。" },
  { s: "BOGO", p: "abbreviation", r: "/ˈboʊɡoʊ/", g: "casual", t: ["shopping"], i: ["talk-money"], gl: "买一送一", ic: "说买一送一促销", ex: "Cereal is BOGO this week.", ep: "Stock up, it's BOGO. — 囤点，买一送一。", rel: [ab("buy one, get one free", "neutral")] },
  { s: "buy one, get one free", p: "phrase", g: "neutral", t: ["shopping"], i: ["talk-money"], gl: "买一送一（完整说法）", ic: "说买一送一", ex: "Buy one, get one free on all candles.", ep: "The sign said buy one, get one free. — 牌子上写着买一送一。", rel: [ab("BOGO", "casual", true)] },
  { s: "rain check", p: "noun", g: "casual", t: ["shopping"], i: ["react-casually"], gl: "改天吧（婉拒邀约）；原指缺货时的补购凭证", ic: "客气地推掉邀约", ex: "Can I take a rain check on dinner?", ep: "Rain check? I'm wiped. — 改天行吗？我累瘫了。" },
  { s: "on clearance", p: "phrase", g: "neutral", t: ["shopping"], i: ["talk-money"], gl: "清仓打折中", ic: "说在清仓甩卖", ex: "I got this jacket on clearance for twelve bucks.", ep: "Check the back, that's where the clearance stuff is. — 去后面看看，清仓的都在那。" },
  // money
  { s: "split the bill", p: "phrase", g: "neutral", t: ["money"], i: ["talk-money"], gl: "AA，分摊账单", ic: "说吃饭 AA", ex: "Want to split the bill?", ep: "Let's split it three ways. — 三个人平摊吧。" },
  { s: "splurge", p: "verb", r: "/splɜːrdʒ/", g: "casual", t: ["money"], i: ["talk-money"], gl: "狠狠花一笔、奢侈一回", ic: "说奢侈一回", ex: "I splurged on good headphones.", ep: "It's your birthday, splurge a little. — 生日嘛，奢侈一下。", rel: [ant("penny-pinch", "casual")] },
  { s: "penny-pinch", p: "verb", g: "casual", t: ["money"], i: ["talk-money"], gl: "抠门、一分一分地省", ic: "说省钱省到抠", ex: "We're penny-pinching until payday.", ep: "Stop penny-pinching, it's two dollars. — 别抠了，才两块钱。", rel: [ant("splurge", "casual")] },
  { s: "broke", p: "adjective", r: "/broʊk/", g: "casual", t: ["money"], i: ["talk-money"], gl: "没钱了、穷", ic: "说手头没钱", ex: "I can't come, I'm broke until Friday.", ep: "Student life: always broke. — 学生生活：永远没钱。" },
  { s: "pricey", p: "adjective", r: "/ˈpraɪsi/", g: "casual", t: ["money", "shopping"], i: ["talk-money"], gl: "偏贵", ic: "说东西有点贵", ex: "That place is a bit pricey for lunch.", ep: "Nice, but pricey. — 好是好，就是贵。", rel: [ant("dirt cheap", "casual")] },
  { s: "dirt cheap", p: "adjective", g: "casual", t: ["money", "shopping"], i: ["talk-money"], gl: "便宜到离谱", ic: "说特别便宜", ex: "Avocados are dirt cheap right now.", ep: "Got it dirt cheap at a garage sale. — 车库甩卖淘的，超便宜。", rel: [ant("pricey", "casual")] },
  // slang
  { s: "ghost", p: "verb", r: "/ɡoʊst/", g: "slang", t: ["slang"], i: ["react-casually"], gl: "突然不回消息、人间蒸发", ic: "说对方突然断联", ex: "We went on three dates and then he ghosted me.", ep: "Don't ghost people, just say you're not interested. — 别玩消失，直说没兴趣就行。", qa: [{ q: "ghost 当动词是什么意思？和 block 有什么区别？", a: "ghost 是不解释地停止回复，人还在好友列表里；block 是直接拉黑。ghost 多用在约会和求职里。" }] },
  { s: "rizz", p: "noun", r: "/rɪz/", g: "slang", t: ["slang"], i: ["react-casually"], gl: "撩人的魅力、搭讪能力", ic: "说某人很会撩", ex: "He's got zero rizz but somehow it works.", ep: "Bro has unspoken rizz. — 这哥们不用开口就有魅力。" },
  { s: "no cap", p: "phrase", g: "slang", t: ["slang"], i: ["react-casually"], gl: "不骗你、说真的", ic: "强调自己没吹牛", ex: "That was the best burger I've ever had, no cap.", ep: "No cap, I finished it in an hour. — 真没吹，我一小时就搞定了。" },
  { s: "lowkey", p: "adverb", r: "/ˈloʊˌkiː/", g: "slang", t: ["slang"], i: ["react-casually"], gl: "有点儿、暗暗地（把语气压低）", ic: "委婉地承认一件事", ex: "I lowkey want to skip the party.", ep: "Lowkey, this song is kind of good. — 说实话这歌还挺好听。", rel: [ant("highkey", "slang")], qa: [{ q: "lowkey 放句首和句中有区别吗？", a: "意思差不多，都是“有点、偷偷地”。放句首更像在坦白，放形容词前更像在弱化程度。" }] },
  { s: "highkey", p: "adverb", r: "/ˈhaɪˌkiː/", g: "slang", t: ["slang"], i: ["react-casually"], gl: "非常明显地、毫不掩饰地", ic: "强调毫不掩饰", ex: "I highkey need a nap.", ep: "Highkey obsessed with this show. — 我是真的迷上这剧了。", rel: [ant("lowkey", "slang")] },
  { s: "bet", p: "interjection", r: "/bɛt/", g: "slang", t: ["slang"], i: ["react-casually"], gl: "行、没问题（答应别人）", ic: "随口答应", ex: "\"Pick you up at seven?\" \"Bet.\"", ep: "Bet, see you there. — 行，那边见。" },
  { s: "sus", p: "adjective", r: "/sʌs/", g: "slang", t: ["slang"], i: ["react-casually"], gl: "可疑（suspicious 的简称）", ic: "说某事某人很可疑", ex: "That email looks sus, don't click it.", ep: "He's acting kind of sus. — 他有点鬼鬼祟祟的。", rel: [ab("suspicious", "neutral", true)] },
  { s: "mid", p: "adjective", r: "/mɪd/", g: "slang", t: ["slang"], i: ["react-casually"], gl: "一般般、平庸（带点嫌弃）", ic: "吐槽东西很一般", ex: "The movie was mid, honestly.", ep: "Everyone hyped it up but it's mid. — 大家吹得很凶，其实一般。" },
  { s: "salty", sk: "salty:upset", p: "adjective", r: "/ˈsɔːlti/", g: "slang", t: ["slang", "mood"], i: ["react-casually"], gl: "酸、不爽（输了或被比下去）", ic: "说某人输了还不服气", ex: "He's still salty about losing that bet.", ep: "Don't be salty, it was a fair game. — 别酸了，比赛很公平。" },
  // texting
  { s: "tbh", p: "abbreviation", g: "slang", t: ["texting"], i: ["text-shorthand"], gl: "说实话（to be honest）", ic: "发消息时缓和语气说实话", ex: "tbh I didn't love the ending", ep: "tbh I forgot. — 说实话我忘了。", rel: [ab("to be honest", "neutral")] },
  { s: "to be honest", p: "phrase", g: "neutral", t: ["texting"], i: ["text-shorthand"], gl: "说实话、老实讲", ic: "说真实想法前的铺垫", ex: "To be honest, I'd rather stay home.", ep: "To be honest, it wasn't my idea. — 老实说这不是我的主意。", rel: [ab("tbh", "slang", true)] },
  { s: "imo", p: "abbreviation", g: "casual", t: ["texting"], i: ["text-shorthand"], gl: "我觉得、依我看（in my opinion）", ic: "发消息时表明是个人看法", ex: "The first one's better imo.", ep: "imo you should take the job. — 我觉得你该接这份工作。", rel: [ab("in my opinion", "neutral")] },
  { s: "ngl", p: "abbreviation", g: "slang", t: ["texting"], i: ["text-shorthand"], gl: "不骗你、说真的（not gonna lie）", ic: "发消息时先打预防针", ex: "ngl that was kind of impressive", ep: "ngl I cried. — 说真的我哭了。", rel: [ab("not gonna lie", "casual")] },
  { s: "brb", p: "abbreviation", g: "slang", t: ["texting"], i: ["text-shorthand"], gl: "马上回来（be right back）", ic: "聊天时说暂时离开", ex: "brb, pizza's here", ep: "brb, charging my phone. — 等下回来，充个电。", rel: [ab("be right back", "casual")] },
  { s: "DM", p: "abbreviation", r: "/ˌdiːˈɛm/", g: "casual", t: ["texting"], i: ["text-shorthand"], gl: "私信（direct message），也能当动词", ic: "说私信联系", ex: "DM me the link.", ep: "Check your DMs. — 看下私信。", rel: [ab("direct message", "neutral")] },
  // work
  { s: "circle back", p: "phrasal verb", g: "neutral", t: ["work"], i: ["coordinate-work"], gl: "回头再说、之后再跟进（职场话术）", ic: "说之后再回到这个话题", ex: "Let's circle back on this next week.", ep: "I'll circle back once I hear from legal. — 等法务回复我再跟进。", qa: [{ q: "circle back 和 follow up 有什么区别？", a: "follow up 是主动追进度；circle back 更像“这个先放一放，之后再回来谈”，常用来在会上暂时搁置话题。" }] },
  { s: "loop [someone] in", k: "pattern", p: "pattern", g: "neutral", t: ["work"], i: ["coordinate-work"], gl: "把某人拉进来、让某人知情", ic: "说把某人加进讨论", ex: "Can you loop me in on that thread?", ep: "loop Sarah in — 把 Sarah 拉进来" },
  { s: "EOD", p: "abbreviation", r: "/ˌiːoʊˈdiː/", g: "casual", t: ["work"], i: ["coordinate-work"], gl: "今天下班前（end of day）", ic: "说截止到今天下班", ex: "Can you send it by EOD?", ep: "I'll have it to you EOD. — 下班前给你。", rel: [ab("end of day", "neutral")] },
  { s: "OOO", p: "abbreviation", r: "/ˌoʊoʊˈoʊ/", g: "casual", t: ["work"], i: ["coordinate-work"], gl: "不在办公室、休假中（out of office）", ic: "说人在休假", ex: "I'm OOO until Monday.", ep: "She's OOO, try her backup. — 她休假了，找她的备岗。", rel: [ab("out of office", "formal")] },
  { s: "out of office", p: "phrase", g: "formal", t: ["work"], i: ["coordinate-work"], gl: "不在办公室（邮件自动回复的说法）", ic: "正式地说不在岗", ex: "I am currently out of office with limited access to email.", ep: "Set your out-of-office reply before you leave. — 走之前设一下自动回复。", rel: [ab("OOO", "casual", true)] },
  { s: "call it a day", p: "idiom", g: "casual", t: ["work"], i: ["end-activity"], gl: "今天就到这、收工", ic: "提议收工", ex: "It's six, let's call it a day.", ep: "We're not getting anywhere, let's call it a day. — 没进展了，收工吧。", rel: [syn("wrap it up", "casual")] },
  { s: "fried", p: "adjective", r: "/fraɪd/", g: "slang", t: ["work"], i: ["describe-feeling"], gl: "脑子烧了、累到转不动", ic: "说累到脑子不转", ex: "I'm totally fried after that meeting marathon.", ep: "My brain is fried, explain it tomorrow. — 脑子烧了，明天再讲。", rel: [syn("burnt out", "casual")] },
  // meetings
  { s: "wrap it up", p: "phrase", g: "casual", t: ["meetings"], i: ["end-activity"], gl: "收尾、结束吧", ic: "催着结束", ex: "We're over time, let's wrap it up.", ep: "Can you wrap it up in two minutes? — 两分钟内收个尾？", rel: [syn("call it a day", "casual")] },
  { s: "take this offline", p: "phrase", g: "neutral", t: ["meetings"], i: ["coordinate-work"], gl: "会后单独聊（别在会上展开）", ic: "建议会后私下讨论", ex: "Let's take this offline so we don't hold everyone up.", ep: "Good point, let's take it offline. — 好问题，会后单聊。" },
  { s: "hard stop", p: "noun", g: "neutral", t: ["meetings"], i: ["end-activity"], gl: "必须准点结束（后面还有事）", ic: "说我几点必须走", ex: "I have a hard stop at three.", ep: "Heads up, hard stop at noon. — 提醒下，我十二点必须走。" },
  { s: "action items", p: "noun", g: "neutral", t: ["meetings"], i: ["coordinate-work"], gl: "会议待办，分到人的任务", ic: "说会后要做的事", ex: "Let's go over the action items before we hang up.", ep: "Who owns the action items? — 这些待办谁负责？" },
  // sleep
  { s: "pull an all-nighter", p: "idiom", g: "casual", t: ["sleep"], i: ["describe-sleep"], gl: "熬通宵，一整夜没睡", ic: "说熬通宵", ex: "I pulled an all-nighter to finish the deck.", ep: "Never again, all-nighters wreck me. — 再也不通宵了，太伤了。", rel: [syn("burn the midnight oil", "neutral")] },
  { s: "sleep in", p: "phrasal verb", g: "neutral", t: ["sleep"], i: ["describe-sleep"], gl: "睡懒觉", ic: "说睡到很晚", ex: "I'm sleeping in on Saturday.", ep: "No alarm tomorrow, I'm sleeping in. — 明天不定闹钟，睡懒觉。" },
  { s: "night owl", p: "noun", g: "casual", t: ["sleep"], i: ["describe-sleep"], gl: "夜猫子", ic: "说习惯晚睡的人", ex: "I'm a total night owl, I do my best work at 1 a.m.", ep: "Night owls hate 8 a.m. meetings. — 夜猫子最恨早上八点的会。", rel: [ant("early bird", "casual")] },
  { s: "early bird", p: "noun", g: "casual", t: ["sleep"], i: ["describe-sleep"], gl: "早起的人", ic: "说习惯早起的人", ex: "She's an early bird, up at five every day.", ep: "Early bird gets the parking spot. — 早到的人才有车位。", rel: [ant("night owl", "casual")] },
  { s: "groggy", p: "adjective", r: "/ˈɡrɑːɡi/", g: "neutral", t: ["sleep"], i: ["describe-sleep"], gl: "刚醒迷迷糊糊、昏沉", ic: "说没睡醒", ex: "I feel groggy if I nap too long.", ep: "Still groggy, give me ten minutes. — 还没醒透，给我十分钟。", rel: [ant("wired", "casual")] },
  { s: "wired", p: "adjective", r: "/waɪərd/", g: "casual", t: ["sleep"], i: ["describe-sleep"], gl: "（喝了咖啡）亢奋得睡不着", ic: "说兴奋得睡不着", ex: "Three coffees and now I'm wired at midnight.", ep: "Too wired to sleep. — 兴奋得睡不着。", rel: [ant("groggy", "neutral")] },
  { s: "jet-lagged", p: "adjective", g: "neutral", t: ["sleep"], i: ["describe-sleep"], gl: "时差没倒过来", ic: "说在倒时差", ex: "I'm still jet-lagged from the flight.", ep: "Jet-lagged and starving at 4 a.m. — 时差没倒，凌晨四点饿醒。" },
  // study
  { s: "burn the midnight oil", p: "idiom", g: "neutral", c: "gaokao", t: ["study"], i: ["describe-study"], gl: "开夜车、熬夜苦读", ic: "说熬夜学习或干活", ex: "She's been burning the midnight oil before finals.", ep: "Burning the midnight oil again? — 又开夜车？", rel: [syn("pull an all-nighter", "casual")] },
  { s: "cram", p: "verb", r: "/kræm/", g: "casual", t: ["study"], i: ["describe-study"], gl: "考前突击、临时抱佛脚", ic: "说考前突击", ex: "I crammed the whole textbook the night before.", ep: "Cramming never works for math. — 数学靠突击没用。" },
  { s: "ace", p: "verb", r: "/eɪs/", g: "casual", t: ["study"], i: ["describe-study"], gl: "（考试）考得很好", ic: "说考得很好", ex: "She aced the exam.", ep: "You're going to ace it. — 你肯定考得很好。", rel: [ant("flunk", "casual")] },
  { s: "flunk", p: "verb", r: "/flʌŋk/", g: "casual", t: ["study"], i: ["describe-study"], gl: "挂科、考砸", ic: "说考试挂了", ex: "I almost flunked chemistry.", ep: "If I flunk this, I'm retaking it in summer. — 挂了就得暑假重修。", rel: [ant("ace", "casual")] },
  { s: "pop quiz", p: "noun", g: "neutral", t: ["study"], i: ["describe-study"], gl: "随堂突击小测", ic: "说突击测验", ex: "We had a pop quiz in bio today.", ep: "Pop quiz, everyone put your phones away. — 突击测验，手机都收起来。" },
  { s: "drill", sk: "drill:practice", p: "noun", r: "/drɪl/", g: "neutral", t: ["study"], i: ["describe-study"], gl: "反复操练；演习（fire drill 是消防演习）", ic: "说反复练习或演习", ex: "We did grammar drills all morning.", ep: "There's a fire drill at ten. — 十点有消防演习。" },
  // driving
  { s: "fender bender", p: "noun", g: "casual", t: ["daily-life"], i: ["describe-driving"], gl: "小剐蹭、轻微追尾", ic: "说小车祸", ex: "Just a fender bender, nobody got hurt.", ep: "I got into a fender bender in the parking lot. — 在停车场蹭了一下。" },
  { s: "rush hour", p: "noun", g: "neutral", t: ["daily-life"], i: ["describe-driving"], gl: "上下班高峰", ic: "说高峰期", ex: "Don't take the 405 at rush hour.", ep: "Rush hour traffic is brutal. — 高峰期堵得要命。" },
  { s: "tailgate", p: "verb", r: "/ˈteɪlɡeɪt/", g: "neutral", t: ["daily-life"], i: ["describe-driving"], gl: "跟车太近；也指比赛前在停车场开派对", ic: "说后车跟得太近", ex: "The guy behind me was tailgating the whole way.", ep: "Stop tailgating, you'll rear-end him. — 别跟这么近，会追尾。", qa: [{ q: "tailgate party 和开车的 tailgate 是一个词吗？", a: "同一个词。tailgate 本义是皮卡后挡板，开车跟太近是贴着人家后挡板，派对是在停车场打开后挡板吃喝。" }] },
  { s: "merge", sk: "merge:driving", p: "verb", r: "/mɜːrdʒ/", g: "neutral", t: ["daily-life"], i: ["describe-driving"], gl: "并道、汇入车流", ic: "说开车并线", ex: "Merge left, the lane ends.", ep: "Nobody would let me merge. — 没人让我并道。" },
  { s: "carpool", p: "verb", r: "/ˈkɑːrpuːl/", g: "neutral", t: ["daily-life"], i: ["describe-driving"], gl: "拼车（同事或家长轮流开）", ic: "说拼车", ex: "We carpool to work on Mondays.", ep: "Want to carpool? — 一起拼车？" },
  // weather
  { s: "muggy", p: "adjective", r: "/ˈmʌɡi/", g: "casual", t: ["daily-life"], i: ["describe-weather"], gl: "闷热潮湿", ic: "说天气又闷又潮", ex: "It's so muggy today, my shirt is stuck to me.", ep: "Muggy and gross out there. — 外面又闷又黏。" },
  { s: "drizzle", p: "noun", r: "/ˈdrɪzəl/", g: "neutral", t: ["daily-life"], i: ["describe-weather"], gl: "毛毛雨", ic: "说下毛毛雨", ex: "It's just a drizzle, you don't need an umbrella.", ep: "Light drizzle all afternoon. — 一下午都在飘毛毛雨。" },
  { s: "sweltering", p: "adjective", r: "/ˈswɛltərɪŋ/", g: "neutral", t: ["daily-life"], i: ["describe-weather"], gl: "热得要命", ic: "说天气酷热", ex: "It was sweltering in the subway.", ep: "A sweltering 105 degrees. — 105 华氏度，热炸了。", rel: [ant("nippy", "casual")] },
  { s: "nippy", p: "adjective", r: "/ˈnɪpi/", g: "casual", t: ["daily-life"], i: ["describe-weather"], gl: "有点冷飕飕的", ic: "说天有点凉", ex: "It's a bit nippy this morning, grab a jacket.", ep: "Nippy out, wear a layer. — 外面有点凉，加件衣服。", rel: [ant("sweltering", "neutral")] },
  { s: "overcast", p: "adjective", r: "/ˈoʊvərkæst/", g: "neutral", t: ["daily-life"], i: ["describe-weather"], gl: "阴天、云层很厚", ic: "说阴天", ex: "Overcast all week in June, classic LA.", ep: "Overcast but no rain. — 阴天但没下雨。", n: "洛杉矶的 June Gloom 就是这个" },
  // mood
  { s: "stoked", p: "adjective", r: "/stoʊkt/", g: "slang", t: ["mood"], i: ["describe-feeling"], gl: "超兴奋、特别期待", ic: "说特别期待", ex: "I'm so stoked for the concert.", ep: "Stoked you could make it! — 你能来太好了！", rel: [ant("bummed", "casual")] },
  { s: "bummed", p: "adjective", r: "/bʌmd/", g: "casual", t: ["mood"], i: ["describe-feeling"], gl: "失望、郁闷", ic: "说有点失落", ex: "I'm bummed I missed the game.", ep: "Bummed it rained. — 下雨了，好扫兴。", rel: [ant("stoked", "slang")] },
  { s: "on edge", p: "phrase", g: "neutral", t: ["mood"], i: ["describe-feeling"], gl: "紧张不安、一点就着", ic: "说心神不宁", ex: "Everyone's on edge waiting for the layoff news.", ep: "Too much coffee puts me on edge. — 咖啡喝多了就心神不宁。" },
  { s: "burnt out", p: "adjective", g: "casual", t: ["mood"], i: ["describe-feeling"], gl: "倦怠、被工作掏空", ic: "说长期累到没劲", ex: "I'm completely burnt out after this quarter.", ep: "Take a week off before you burn out. — 趁还没倦怠先休一周。", rel: [syn("fried", "slang")] },
  // dev (cs)
  { s: "edge case", p: "noun", g: "technical", c: "cs", t: ["dev"], i: ["talk-code"], gl: "边界情况（极端或少见的输入）", ic: "说没考虑到的特殊输入", ex: "Empty input is an edge case we forgot.", ep: "Did you test the edge cases? — 边界情况测了吗？" },
  { s: "race condition", p: "noun", g: "technical", c: "cs", t: ["dev"], i: ["talk-code"], gl: "竞态条件（两个线程抢着改同一个东西）", ic: "说偶发的并发 bug", ex: "It only fails sometimes, smells like a race condition.", ep: "There's a race condition in the cache layer. — 缓存层有竞态。" },
  { s: "flaky test", p: "noun", g: "technical", c: "cs", t: ["dev"], i: ["talk-code"], gl: "时过时不过的测试", ic: "说不稳定的测试", ex: "Rerun it, that's a flaky test.", ep: "Quarantine the flaky tests. — 把不稳定的测试先隔离。" },
  { s: "tech debt", p: "noun", g: "technical", c: "cs", t: ["dev"], i: ["talk-code"], gl: "技术债（为了赶工留下的坑）", ic: "说代码里欠的债", ex: "We need a sprint just to pay down tech debt.", ep: "That hack is tech debt we'll regret. — 这个临时方案以后要还的。" },
  { s: "off-by-one error", p: "noun", g: "technical", c: "cs", t: ["dev"], i: ["talk-code"], gl: "差一错误（循环多跑或少跑一次）", ic: "说边界差一的 bug", ex: "The last item is missing, classic off-by-one error.", ep: "Check the loop bounds for an off-by-one. — 看看循环边界是不是差一。" },
  { s: "repro", p: "noun", r: "/ˈriːproʊ/", g: "casual", c: "cs", t: ["dev"], i: ["talk-code"], gl: "复现步骤（reproduction 的简称）", ic: "要能稳定复现 bug 的步骤", ex: "Can you send me a minimal repro?", ep: "No repro, no fix. — 复现不了就没法修。", rel: [ab("reproduction", "technical")] },
  { s: "PR", sk: "PR:code", p: "abbreviation", r: "/ˌpiːˈɑːr/", g: "casual", c: "cs", t: ["dev"], i: ["talk-code"], gl: "合并请求（pull request）", ic: "说提交代码给人审", ex: "I'll put up a PR tonight.", ep: "Can you review my PR? — 帮我看下 PR？", rel: [ab("pull request", "technical")] },
  { s: "pull request", p: "noun", g: "technical", c: "cs", t: ["dev"], i: ["talk-code"], gl: "代码合并请求", ic: "正式地说合并请求", ex: "Open a pull request against main.", ep: "The pull request needs two approvals. — 这个合并请求要两人批准。", rel: [ab("PR", "casual", true)] },
  { s: "LGTM", p: "abbreviation", g: "casual", c: "cs", t: ["dev"], i: ["talk-code"], gl: "看着没问题（looks good to me，代码评审用）", ic: "评审时表示通过", ex: "LGTM, ship it.", ep: "LGTM after the rename. — 改完名就可以合了。", rel: [ab("looks good to me", "neutral")] },
  { s: "merge", sk: "merge:git", p: "verb", r: "/mɜːrdʒ/", g: "technical", c: "cs", t: ["dev"], i: ["talk-code"], gl: "（git）合并分支", ic: "说把分支合进去", ex: "Don't merge until CI is green.", ep: "Merge it after lunch. — 午饭后合。" },
  // academic (toefl)
  { s: "mitigate", p: "verb", r: "/ˈmɪtɪɡeɪt/", g: "academic", c: "toefl", t: ["academic"], i: ["argue-a-point"], gl: "减轻、缓解（负面影响）", ic: "写作里说减轻某种影响", ex: "Planting trees can mitigate urban heat.", ep: "Measures to mitigate the risk. — 降低风险的措施。", rel: [ant("exacerbate", "academic")] },
  { s: "exacerbate", p: "verb", r: "/ɪɡˈzæsərbeɪt/", g: "academic", c: "toefl", t: ["academic"], i: ["argue-a-point"], gl: "使恶化、加剧", ic: "写作里说让问题更糟", ex: "Cutting funding would exacerbate the problem.", ep: "Stress can exacerbate symptoms. — 压力会加重症状。", rel: [ant("mitigate", "academic")] },
  { s: "corroborate", p: "verb", r: "/kəˈrɑːbəreɪt/", g: "academic", c: "toefl", t: ["academic"], i: ["argue-a-point"], gl: "证实、佐证（用别的证据支持）", ic: "说有别的证据支持", ex: "The second study corroborates these findings.", ep: "No data corroborates his claim. — 没有数据支持他的说法。" },
  { s: "plausible", p: "adjective", r: "/ˈplɔːzəbəl/", g: "formal", c: "toefl", t: ["academic"], i: ["argue-a-point"], gl: "说得通的、看似合理的", ic: "说一个解释站得住", ex: "That's a plausible explanation, but we need evidence.", ep: "A plausible but untested theory. — 合理但没验证过的理论。" },
  { s: "anecdotal", p: "adjective", r: "/ˌænɪkˈdoʊtəl/", g: "academic", c: "toefl", t: ["academic"], i: ["argue-a-point"], gl: "个例的、道听途说的（不是系统数据）", ic: "说证据只是个例", ex: "The evidence is mostly anecdotal.", ep: "Anecdotal evidence isn't proof. — 个例不等于证据。" },
  { s: "trade-off", p: "noun", r: "/ˈtreɪdˌɔːf/", g: "formal", c: "toefl", t: ["academic", "dev"], i: ["argue-a-point"], gl: "权衡、取舍", ic: "说两头不能兼得", ex: "There's a trade-off between speed and accuracy.", ep: "Every design is a trade-off. — 每个设计都是取舍。" },
  { s: "confound", p: "verb", r: "/kənˈfaʊnd/", g: "academic", c: "toefl", t: ["academic"], i: ["argue-a-point"], gl: "（研究里）混淆、干扰结论", ic: "说有别的因素搅乱了结论", ex: "Age may confound the link between income and health.", ep: "A confounding variable. — 混杂变量。", qa: [{ q: "confound 在论文里和日常的 confuse 一样吗？", a: "不一样。研究语境里 confound 指第三个变量同时影响自变量和因变量，让你没法下因果结论，名词是 confounder。" }] },
  // essay (gaokao)
  { s: "a double-edged sword", p: "idiom", g: "formal", c: "gaokao", t: ["essay"], i: ["argue-a-point"], gl: "双刃剑", ic: "作文里说有利有弊", ex: "Social media is a double-edged sword.", ep: "Technology is a double-edged sword. — 科技是一把双刃剑。" },
  { s: "strike a balance", p: "phrase", g: "formal", c: "gaokao", t: ["essay"], i: ["argue-a-point"], gl: "找到平衡、两头兼顾", ic: "作文里说要兼顾两方", ex: "Students must strike a balance between study and rest.", ep: "Strike a balance between work and life. — 在工作和生活间找到平衡。" },
  { s: "go the extra mile", p: "idiom", g: "neutral", c: "gaokao", t: ["essay"], i: ["argue-a-point"], gl: "多做一步、额外付出", ic: "说比要求的多做一点", ex: "Good teachers go the extra mile for their students.", ep: "She always goes the extra mile. — 她总是多付出一些。" },
  { s: "tip of the iceberg", p: "idiom", g: "neutral", c: "gaokao", t: ["essay"], i: ["argue-a-point"], gl: "冰山一角", ic: "说看到的只是一小部分", ex: "These cases are just the tip of the iceberg.", ep: "That's only the tip of the iceberg. — 这只是冰山一角。" },
  { s: "be here to stay", p: "phrase", g: "neutral", c: "gaokao", t: ["essay"], i: ["argue-a-point"], gl: "会一直存在下去，不是一阵风", ic: "说某个趋势会长期存在", ex: "Remote work is here to stay.", ep: "Online learning is here to stay. — 网课会长期存在。" },
  // hair
  { s: "hairline", p: "noun", r: "/ˈhɛrlaɪn/", g: "neutral", t: ["hair"], i: ["describe-body"], gl: "发际线", ic: "说发际线", ex: "My hairline is creeping back.", ep: "Receding hairline at 25. — 25 岁发际线就后移了。" },
  { s: "hair transplant", p: "noun", g: "neutral", t: ["hair"], i: ["describe-body"], gl: "植发", ic: "说植发手术", ex: "He went to Turkey for a hair transplant.", ep: "Hair transplants aren't cheap. — 植发可不便宜。" },
  { s: "bedhead", p: "noun", r: "/ˈbɛdhɛd/", g: "casual", t: ["hair"], i: ["describe-body"], gl: "刚睡醒的乱头发", ic: "说睡乱的头发", ex: "Sorry about the bedhead, I just woke up.", ep: "Bedhead, but make it fashion. — 睡乱的头发，硬说是造型。" },
  { s: "cowlick", p: "noun", r: "/ˈkaʊlɪk/", g: "neutral", t: ["hair"], i: ["describe-body"], gl: "怎么都压不下去的那撮翘毛", ic: "说头上翘起来的一撮", ex: "I can't get this cowlick to lie flat.", ep: "Every photo, the same cowlick. — 每张照片都是那撮呆毛。" },
  // music
  { s: "bass", sk: "bass:music", p: "noun", r: "/beɪs/", g: "neutral", t: ["music"], i: ["talk-music"], gl: "低音；贝斯（读 /beɪs/）", ic: "说低音或贝斯", ex: "Turn the bass down, the neighbors are complaining.", ep: "He plays bass in a band. — 他在乐队弹贝斯。" },
  { s: "earworm", p: "noun", r: "/ˈɪrwɜːrm/", g: "casual", t: ["music"], i: ["talk-music"], gl: "洗脑神曲、脑子里单曲循环的旋律", ic: "说一首歌洗脑", ex: "That jingle is such an earworm.", ep: "Thanks for the earworm. — 谢谢你让我被洗脑。" },
  { s: "banger", p: "noun", r: "/ˈbæŋər/", g: "slang", t: ["music"], i: ["talk-music"], gl: "炸场好歌、超好听的歌", ic: "夸一首歌很好听", ex: "This new track is an absolute banger.", ep: "Every song on the album is a banger. — 整张专辑首首都炸。" },
];

// Tag drift on purpose: zest/simmer/mince sit in "in-the-kitchen" beside "kitchen",
// reps/sesh/PR in "gym-talk" beside "gym", and weather + driving share one
// catch-all "daily-life". Live tagging drifts like this in real use; it gives
// Settings → Organize (the LLM regrouping) something to merge and split.

// Proper nouns (v4 §1): pronunciation-first cards, no topics/intents/gloss.
// pron_approximate = the two strong models gave different respellings.
const NAMES = [
  { s: "De Bruyne", st: "person", id: "比利时足球运动员", rs: "duh-BROYN", an: false, ap: false, ct: "football" },
  { s: "Mbappé", st: "person", id: "法国足球运动员", rs: "em-BAP-ay", an: false, ap: true, ct: "football" },
  { s: "Giannis Antetokounmpo", st: "person", id: "希腊籍 NBA 球员", rs: "YAH-nis an-teh-toh-KOON-poh", an: false, ap: false, ct: "basketball" },
  { s: "Saoirse Ronan", st: "person", id: "爱尔兰女演员", rs: "SUR-shuh ROH-nuhn", an: false, ap: false, ct: "film" },
  { s: "Timothée Chalamet", st: "person", id: "美国男演员", rs: "TIM-uh-thee SHAL-uh-may", an: false, ap: false, ct: "film" },
  { s: "Joaquin Phoenix", st: "person", id: "美国男演员", rs: "wah-KEEN FEE-niks", an: false, ap: false, ct: "film" },
  { s: "Hermès", st: "brand", id: "法国奢侈品牌", rs: "air-MEZ", an: false, ap: false, ct: "fashion" },
  { s: "Porsche", st: "brand", id: "德国跑车品牌", rs: "POR-shuh", an: false, ap: true, ct: "cars" },
  { s: "Hyundai", st: "brand", id: "韩国汽车品牌", rs: "HUN-day", an: true, ap: false, ct: "cars" },
  { s: "Nike", st: "brand", id: "美国运动品牌", rs: "NY-kee", an: true, ap: false, ct: "sportswear" },
  { s: "Worcester", st: "place", id: "美国马萨诸塞州城市（英国也有同名城市）", rs: "WUUS-ter", an: true, ap: false, ct: "places" },
  { s: "Yosemite", st: "place", id: "加州的国家公园", rs: "yoh-SEM-ih-tee", an: true, ap: false, ct: "places" },
  { s: "pho", st: null, id: "越南牛肉河粉", rs: "fuh", an: false, ap: true, ct: "food" },
  { s: "gnocchi", st: null, id: "意大利土豆面疙瘩", rs: "NYOH-kee", an: false, ap: false, ct: "food" },
  { s: "bruschetta", st: null, id: "意式烤面包片配番茄", rs: "broo-SKET-uh", an: false, ap: true, ct: "food" },
];

// Deterministic PRNG so re-running produces the same spread (relative to today).
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function build(now) {
  const rand = rng(20261029);
  const rows = [];
  const base = {
    kind: "word", pos: null, reading: null, gloss_cn: null, intent_cn: null, subtype: null, respelling: null,
    identity: null, anglicized: null, pron_approximate: null, coarse_tag: null, note: null, register: null,
    corpus: null, sense_key: null, example_src: "", example_parallel: null, example_gen: null, topics: [],
    intents: [], relations: [], embedding: null, qa_log: null, srs_state: null,
  };
  for (const w of WORDS) {
    const id = "sample-" + slug(w.sk ? w.sk.replace(":", "-") : w.s);
    rows.push({
      id, ...base,
      surface: w.s,
      kind: w.k || (w.s.includes(" ") ? "phrase" : "word"),
      pos: w.p, reading: w.r ?? null, gloss_cn: w.gl, intent_cn: w.ic, note: w.n ?? null,
      register: w.g, corpus: w.c || "life", sense_key: w.sk ?? null,
      example_src: w.ex, example_parallel: w.ep, topics: w.t, intents: w.i,
      relations: w.rel || [], qa_log: w.qa ?? null,
    });
  }
  for (const n of NAMES) {
    rows.push({
      id: "sample-" + slug(n.s), ...base, surface: n.s, kind: "proper_noun", subtype: n.st, identity: n.id,
      respelling: n.rs, anglicized: n.an, pron_approximate: n.ap, coarse_tag: n.ct, corpus: "life",
    });
  }
  // Timestamps: spread over the last ~120 days; about a third edited later.
  for (const r of rows) {
    r.created_at = Math.round(now - (2 + rand() * 118) * DAY);
    r.updated_at = rand() < 0.35 ? Math.min(now - DAY, Math.round(r.created_at + rand() * 20 * DAY)) : r.created_at;
  }
  // Light review history on ~1 in 7 cards, a few with misses for the wrong-item list.
  for (const r of rows) {
    if (rand() < 0.15) {
      const seen = 1 + Math.floor(rand() * 6), wrong = rand() < 0.4 ? 1 + Math.floor(rand() * 2) : 0;
      r.srs_state = { wrong, seen, got: Math.max(0, seen - wrong), last_seen: Math.round(r.created_at + rand() * (now - r.created_at)) };
    }
  }
  rows.sort((a, b) => b.created_at - a.created_at);
  return rows;
}

// Typed edges from card relations whose target is also in the vault. A surface
// shared by two senses (PR, merge…) resolves to the sense sharing a topic.
function deriveEdges(rows) {
  const bySurface = new Map();
  for (const r of rows) {
    const k = r.surface.toLowerCase();
    bySurface.set(k, [...(bySurface.get(k) || []), r]);
  }
  const seen = new Set(), edges = [];
  for (const r of rows) {
    for (const rel of r.relations) {
      const cands = bySurface.get(rel.surface.toLowerCase()) || [];
      const to = cands.find((c) => c.topics.some((t) => r.topics.includes(t))) || cands[0];
      if (!to) continue;
      const key = [r.id, to.id].sort().join("|") + "|" + rel.type;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ id: `${r.id}~${to.id}~${rel.type}`, from_id: r.id, to_id: to.id, type: rel.type, source: "sample", confidence: null });
    }
  }
  return edges;
}

function check(rows) {
  const fail = (m) => { console.error("check failed: " + m); process.exit(1); };
  const count = (field) => {
    const m = {};
    for (const r of rows) for (const t of r[field]) m[t] = (m[t] || 0) + 1;
    return m;
  };
  const topics = count("topics"), intents = count("intents");
  const nT = Object.keys(topics).length, nI = Object.keys(intents).length;
  if (rows.length !== 150) fail(`${rows.length} rows, want 150`);
  if (new Set(rows.map((r) => r.id)).size !== rows.length) fail("duplicate ids");
  if (nT < 20 || nT > 25) fail(`${nT} topics`);
  if (nI < 15 || nI > 20) fail(`${nI} intents`);
  for (const [t, n] of [...Object.entries(topics), ...Object.entries(intents)]) if (n < 3) fail(`tag ${t} has ${n}`);
  const regs = {};
  for (const r of rows) if (r.register) regs[r.register] = (regs[r.register] || 0) + 1;
  const withReg = Object.values(regs).reduce((a, b) => a + b, 0);
  for (const g of ["neutral", "casual", "slang", "formal", "technical", "academic"]) if (!regs[g]) fail(`no ${g}`);
  if (regs.neutral / withReg > 0.55) fail(`neutral ${regs.neutral}/${withReg}`);
  const corp = {};
  for (const r of rows) corp[r.corpus] = (corp[r.corpus] || 0) + 1;
  return { topics: nT, intents: nI, regs, corp, smallestTag: Math.min(...Object.values(topics), ...Object.values(intents)) };
}

function readKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, "utf8").match(/^OPENAI_API_KEY=(.+)$/m);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

// Same text the app embeds (reassign/index.js wordText).
const wordText = (e) => `${e.surface}${e.gloss_cn ? " — " + e.gloss_cn : ""}`;

async function embed(rows, key) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: rows.map(wordText) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  // 5 decimals keeps cosine error far below anything the app thresholds on
  // and roughly halves the file.
  data.data.forEach((d, i) => (rows[i].embedding = d.embedding.map((x) => Math.round(x * 1e5) / 1e5)));
}

// One expression per line: readable diffs without a 1536-line embedding block each.
function serialize(vault) {
  const { expressions, ...head } = vault;
  const top = JSON.stringify({ ...head, expressions: "__X__" }, null, 2);
  return top.replace('"__X__"', "[\n" + expressions.map((e) => "    " + JSON.stringify(e)).join(",\n") + "\n  ]") + "\n";
}

const now = Date.now();
const rows = build(now);
const stats = check(rows);
const edges = deriveEdges(rows);
const key = process.argv.includes("--no-embed") ? null : readKey();
if (key) {
  await embed(rows, key);
  console.log(`embedded ${rows.length} expressions (text-embedding-3-small)`);
} else if (!process.argv.includes("--no-embed")) {
  console.log("需要 OPENAI_API_KEY 才能补 embedding");
}
const vault = {
  version: 1,
  exported_at: now,
  _note: "SYNTHETIC demo vault: 150 hand-written example entries generated by tools/make-sample-vault.mjs, not anyone's real usage. Load it from Settings → Sync & data → Load sample vault. Tags are rebuilt from the expressions on import.",
  expressions: rows,
  tags: [],
  edges,
  tombstones: [],
};
fs.writeFileSync(OUT, serialize(vault));
const byType = edges.reduce((m, e) => ((m[e.type] = (m[e.type] || 0) + 1), m), {});
console.log(`wrote ${path.relative(ROOT, OUT)}: ${rows.length} expressions, ${stats.topics} topics, ${stats.intents} intents (smallest tag ${stats.smallestTag}), edges ${JSON.stringify(byType)}`);
console.log("registers", stats.regs, "corpus", stats.corp);
