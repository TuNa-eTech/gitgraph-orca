// Emoji shortcodes in commit subjects: a common GitHub subset, the gitmoji set, and user mappings
// from the `customEmojiShortcodes` setting (a JSON object of `name: emoji`).

const COMMON = `
smile=😄 smiley=😃 grinning=😀 grin=😁 laughing=😆 satisfied=😆 joy=😂 rofl=🤣 blush=😊 innocent=😇 wink=😉
relaxed=☺️ yum=😋 sunglasses=😎 heart_eyes=😍 kissing_heart=😘 neutral_face=😐 expressionless=😑 unamused=😒
sweat_smile=😅 sweat=😓 disappointed=😞 worried=😟 angry=😠 rage=😡 cry=😢 sob=😭 scream=😱 fearful=😨
confused=😕 tired_face=😫 weary=😩 sleeping=😴 mask=😷 thinking=🤔 shushing_face=🤫 hugs=🤗 facepalm=🤦 shrug=🤷
upside_down_face=🙃 slightly_smiling_face=🙂 slightly_frowning_face=🙁 hushed=😯 open_mouth=😮 flushed=😳
dizzy_face=😵 skull=💀 ghost=👻 alien=👽 robot=🤖 poop=💩 hankey=💩 see_no_evil=🙈 hear_no_evil=🙉 speak_no_evil=🙊
+1=👍 thumbsup=👍 -1=👎 thumbsdown=👎 clap=👏 raised_hands=🙌 pray=🙏 muscle=💪 ok_hand=👌 v=✌️ wave=👋
point_up=☝️ point_down=👇 point_left=👈 point_right=👉 fist=✊ punch=👊 handshake=🤝 writing_hand=✍️ eyes=👀
brain=🧠 bone=🦴 tongue=👅 ear=👂 nose=👃 footprints=👣
heart=❤️ orange_heart=🧡 yellow_heart=💛 green_heart=💚 blue_heart=💙 purple_heart=💜 black_heart=🖤 broken_heart=💔
sparkling_heart=💖 two_hearts=💕 heartbeat=💓 revolving_hearts=💞 cupid=💘 gift_heart=💝
star=⭐ star2=🌟 sparkles=✨ sparkle=❇️ dizzy=💫 boom=💥 collision=💥 fire=🔥 zap=⚡ snowflake=❄️ sunny=☀️ cloud=☁️
umbrella=☔ rainbow=🌈 droplet=💧 ocean=🌊 earth_americas=🌎 earth_africa=🌍 earth_asia=🌏 globe_with_meridians=🌐
moon=🌙 full_moon=🌕 new_moon=🌑 comet=☄️ sunrise=🌅 volcano=🌋 mountain=⛰️ snowman=⛄ tada=🎉 confetti_ball=🎊
balloon=🎈 gift=🎁 ribbon=🎀 trophy=🏆 medal_sports=🏅 first_place_medal=🥇 crown=👑 gem=💎 100=💯 1234=🔢
white_check_mark=✅ heavy_check_mark=✔️ check=✔️ ballot_box_with_check=☑️ x=❌ negative_squared_cross_mark=❎
heavy_multiplication_x=✖️ warning=⚠️ no_entry=⛔ no_entry_sign=🚫 stop_sign=🛑 question=❓ grey_question=❔ exclamation=❗
heavy_exclamation_mark=❗ grey_exclamation=❕ bangbang=‼️ interrobang=⁉️ information_source=ℹ️ sos=🆘 new=🆕 free=🆓
up=🆙 ok=🆗 cool=🆒 top=🔝 soon=🔜 back=🔙 end=🔚 on=🔛 recycle=♻️ infinity=♾️ copyright=©️ registered=®️ tm=™️
arrow_up=⬆️ arrow_down=⬇️ arrow_left=⬅️ arrow_right=➡️ arrow_upper_right=↗️ arrow_lower_right=↘️ arrow_heading_up=⤴️
arrow_heading_down=⤵️ leftwards_arrow_with_hook=↩️ arrow_right_hook=↪️ repeat=🔁 repeat_one=🔂 arrows_counterclockwise=🔄
arrows_clockwise=🔃 rewind=⏪ fast_forward=⏩ play_or_pause_button=⏯️ twisted_rightwards_arrows=🔀 left_right_arrow=↔️
heavy_plus_sign=➕ heavy_minus_sign=➖ heavy_division_sign=➗ plus=➕ minus=➖ wavy_dash=〰️ curly_loop=➰ loop=➿
red_circle=🔴 orange_circle=🟠 yellow_circle=🟡 green_circle=🟢 large_blue_circle=🔵 purple_circle=🟣 black_circle=⚫
white_circle=⚪ red_square=🟥 green_square=🟩 blue_square=🟦 small_red_triangle=🔺 small_red_triangle_down=🔻
house=🏠 office=🏢 factory=🏭 hospital=🏥 school=🏫 bank=🏦 construction=🚧 construction_worker=👷 rotating_light=🚨
rocket=🚀 airplane=✈️ car=🚗 bus=🚌 train=🚆 ship=🚢 bike=🚲 truck=🚚 fuelpump=⛽ anchor=⚓ traffic_light=🚥
computer=💻 desktop_computer=🖥️ keyboard=⌨️ iphone=📱 phone=☎️ telephone=☎️ battery=🔋 electric_plug=🔌 floppy_disk=💾
cd=💿 dvd=📀 minidisc=💽 camera=📷 video_camera=📹 tv=📺 radio=📻 satellite=📡 bulb=💡 flashlight=🔦 mag=🔍 mag_right=🔎
microscope=🔬 telescope=🔭 test_tube=🧪 dna=🧬 pill=💊 syringe=💉 stethoscope=🩺 adhesive_bandage=🩹
lock=🔒 unlock=🔓 closed_lock_with_key=🔐 key=🔑 old_key=🗝️ shield=🛡️ hammer=🔨 hammer_and_wrench=🛠️ wrench=🔧
nut_and_bolt=🔩 gear=⚙️ toolbox=🧰 magnet=🧲 bomb=💣 knife=🔪 dagger=🗡️ crossed_swords=⚔️ pick=⛏️ axe=🪓 link=🔗 chains=⛓️
paperclip=📎 paperclips=🖇️ pushpin=📌 round_pushpin=📍 scissors=✂️ pencil=📝 pencil2=✏️ memo=📝 pen=🖊️ fountain_pen=🖋️
paintbrush=🖌️ crayon=🖍️ lipstick=💄 art=🎨 book=📖 books=📚 notebook=📓 ledger=📒 page_facing_up=📄 page_with_curl=📃
newspaper=📰 bookmark=🔖 bookmark_tabs=📑 label=🏷️ file_folder=📁 open_file_folder=📂 card_index_dividers=🗂️ card_file_box=🗃️
file_cabinet=🗄️ wastebasket=🗑️ package=📦 mailbox=📫 email=📧 envelope=✉️ inbox_tray=📥 outbox_tray=📤 incoming_envelope=📨
calendar=📆 date=📅 spiral_calendar=🗓️ chart_with_upwards_trend=📈 chart_with_downwards_trend=📉 bar_chart=📊 clipboard=📋
bell=🔔 no_bell=🔕 loudspeaker=📢 mega=📣 speech_balloon=💬 thought_balloon=💭 hourglass=⌛ hourglass_flowing_sand=⏳ watch=⌚
alarm_clock=⏰ stopwatch=⏱️ timer_clock=⏲️ clock=🕐 moneybag=💰 dollar=💵 money_with_wings=💸 credit_card=💳 receipt=🧾
coffee=☕ tea=🍵 beer=🍺 beers=🍻 wine_glass=🍷 cocktail=🍸 pizza=🍕 hamburger=🍔 fries=🍟 cake=🍰 cookie=🍪 apple=🍎
egg=🥚 seedling=🌱 evergreen_tree=🌲 deciduous_tree=🌳 palm_tree=🌴 cactus=🌵 herb=🌿 four_leaf_clover=🍀 maple_leaf=🍁
fallen_leaf=🍂 cherry_blossom=🌸 rose=🌹 sunflower=🌻 tulip=🌷 bug=🐛 ant=🐜 bee=🐝 beetle=🐞 butterfly=🦋 snail=🐌 spider=🕷️
cat=🐱 dog=🐶 mouse=🐭 rabbit=🐰 fox_face=🦊 bear=🐻 panda_face=🐼 koala=🐨 tiger=🐯 lion=🦁 cow=🐮 pig=🐷 frog=🐸 monkey=🐒
chicken=🐔 penguin=🐧 bird=🐦 eagle=🦅 owl=🦉 turtle=🐢 snake=🐍 dragon=🐉 whale=🐳 dolphin=🐬 fish=🐟 octopus=🐙 crab=🦀
unicorn=🦄 horse=🐴 camel=🐫 elephant=🐘 rat=🐀 hatching_chick=🐣 beginner=🔰 trident=🔱 fleur_de_lis=⚜️ atom_symbol=⚛️
hourglass_done=⌛ checkered_flag=🏁 triangular_flag_on_post=🚩 crossed_flags=🎌 black_flag=🏴 white_flag=🏳️ video_game=🎮
joystick=🕹️ game_die=🎲 jigsaw=🧩 dart=🎯 bowling=🎳 art_palette=🎨 musical_note=🎵 notes=🎶 headphones=🎧 microphone=🎤
speaker=🔈 mute=🔇 loud_sound=🔊 sound=🔉 guitar=🎸 clapper=🎬 ticket=🎫 performing_arts=🎭 busts_in_silhouette=👥
bust_in_silhouette=👤 family=👪 baby=👶 man=👨 woman=👩 older_man=👴 older_woman=👵 man_technologist=👨‍💻 woman_technologist=👩‍💻
technologist=🧑‍💻 construction_worker_man=👷‍♂️ santa=🎅 angel=👼 police_officer=👮 detective=🕵️ zombie=🧟 mage=🧙 fairy=🧚
`

const GITMOJI = `
art=🎨 zap=⚡ fire=🔥 bug=🐛 ambulance=🚑 sparkles=✨ memo=📝 rocket=🚀 lipstick=💄 tada=🎉 white_check_mark=✅
lock=🔒 closed_lock_with_key=🔐 bookmark=🔖 rotating_light=🚨 construction=🚧 green_heart=💚 arrow_down=⬇️ arrow_up=⬆️
pushpin=📌 construction_worker=👷 chart_with_upwards_trend=📈 recycle=♻️ heavy_plus_sign=➕ heavy_minus_sign=➖ wrench=🔧
hammer=🔨 globe_with_meridians=🌐 pencil2=✏️ poop=💩 rewind=⏪ twisted_rightwards_arrows=🔀 package=📦 alien=👽 truck=🚚
page_facing_up=📄 boom=💥 bento=🍱 wheelchair=♿ bulb=💡 beers=🍻 speech_balloon=💬 card_file_box=🗃️ loud_sound=🔊 mute=🔇
busts_in_silhouette=👥 children_crossing=🚸 building_construction=🏗️ iphone=📱 clown_face=🤡 egg=🥚 see_no_evil=🙈
camera_flash=📸 alembic=⚗️ mag=🔍 label=🏷️ seedling=🌱 triangular_flag_on_post=🚩 goal_net=🥅 dizzy=💫 wastebasket=🗑️
passport_control=🛂 adhesive_bandage=🩹 monocle_face=🧐 coffin=⚰️ test_tube=🧪 necktie=👔 stethoscope=🩺 bricks=🧱
technologist=🧑‍💻 money_with_wings=💸 thread=🧵 safety_vest=🦺 airplane=✈️ fire_engine=🚒 hammer_and_wrench=🛠️
`

function parseTable(source: string): Record<string, string> {
  const table: Record<string, string> = {}
  for (const entry of source.split(/\s+/)) {
    const eq = entry.indexOf('=')
    if (eq > 0) table[entry.slice(0, eq)] = entry.slice(eq + 1)
  }
  return table
}

const BUILTIN: Record<string, string> = { ...parseTable(COMMON), ...parseTable(GITMOJI) }

/** Parses the `customEmojiShortcodes` setting; anything but a JSON object of strings is ignored. */
export function parseCustomEmoji(json: string): Record<string, string> {
  if (json.trim() === '') return {}
  try {
    const parsed: unknown = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') result[key.replace(/^:|:$/g, '')] = value
    }
    return result
  } catch {
    return {}
  }
}

/** Replaces `:name:` shortcodes by emoji; unknown names stay as written. */
export function expandEmoji(text: string, custom: Record<string, string>): string {
  if (!text.includes(':')) return text
  return text.replace(/:([a-z0-9_+-]+):/gi, (whole, name: string) => {
    const key = name.toLowerCase()
    return custom[name] ?? custom[key] ?? BUILTIN[key] ?? whole
  })
}
