import Foundation

// 第 102 条设备三条道的「设备侧最后一道墙」：服务端在 agent/src/devices/lanes.ts 按用途 + 参数判道，
// 设备拿不到用途，只按参数判，判不准从严（付款从严到关死、敏感从严到要你点）。
// - deny（关死）：付款、下单、转账。只有在设备上签名放开过 payments 才降为 confirm，否则直接拒。
// - confirm（要你点）：读钥匙串 / 密码库 / 密钥、security find-* 这类读密码或改系统设置的命令、打开或在系统设置里点击。
// - allow（放行）：其余的，照设备上限执行。
// 网页标签（第 3 批）先按参数判，找到要点 / 要填的元素后再按它的 DOM 事实判一次（classifyTarget）。
// 问这一页按编号操作（tab_act，11-04 第 3 批）不在这里关死提交：PageOperateScript 认出提交就不点，放行凭他的卡。
enum DeviceLane: Equatable {
    case allow
    case confirm
    case deny
}

enum DeviceLanePolicy {
    // 付款、收款页面的主机（与 lanes.ts 保持一致）。
    private static let paymentHosts = ["alipay.com", "pay.weixin.qq.com", "wx.tenpay.com", "tenpay.com",
                                       "paypal.com", "checkout.stripe.com", "pay.google.com", "pay.apple.com",
                                       "unionpay.com", "95516.com"]

    private static let paymentPath = regex("/(?:checkout|pay|payment|payments|cashier|buy|purchase"
        + "|order/(?:confirm|submit|pay))(?:[/?#]|$)")
    private static let paymentSchemes = regex("\\b(?:alipay|alipays|weixin|wechat|paypal|unionpay)s?://")
    private static let httpUrl = regex("https?://\\S+")
    // 网页标签：付款、下单的用词和按钮写法（与 lanes.ts 的 PAYMENT_WORDS、PAYMENT_TARGET 一致）。
    private static let paymentWords = regex("付款|支付|付钱|买单|结账|下单|购买|买下|订购|下订单|提交订单|转账|汇款|打款"
        + "|充值|提现|发红包|扫码付|\\bpay(?:ment|pal)?\\b|\\bcheckout\\b|\\bpurchase\\b|\\bbuy\\b"
        + "|place\\s+(?:an\\s+)?order|\\btransfer\\b|\\bwire\\b", caseInsensitive: true)
    private static let paymentTarget = regex("checkout|place[-_\\s]?order|submit[-_\\s]?order|pay[-_\\s]?now"
        + "|buy[-_\\s]?now|purchase|支付|付款|下单|结账|购买|买单|转账|汇款|充值", caseInsensitive: true)
    // 卡号、安全码、有效期框；密码框（与 lanes.ts 的 CARD_FIELD、PASSWORD_FIELD 一致）。
    private static let cardField = regex("\\bcc-(?:number|csc|exp|exp-month|exp-year|name|type)\\b"
        + "|card[-_]?(?:number|no)|\\bcvv\\b|\\bcvc\\b|卡号|安全码|有效期", caseInsensitive: true)
    private static let passwordField = regex("type\\s*=\\s*[\"']?password|passw(?:or)?d|\\bpwd\\b|passcode|密码|口令",
                                             caseInsensitive: true)
    // 13–19 位卡号（允许空格、连字符分组），再过 Luhn 校验。
    private static let cardNumber = regex("(?:[0-9][ -]?){13,19}")

    // 钥匙串、密码库、密钥目录（与 lanes.ts 的 SECRET_PATHS 一致）。
    private static let secretPaths = [
        regex("(?:^|/)\\.ssh(?:/|$)"), regex("Library/Keychains(?:/|$)"), regex("(?:^|/)\\.gnupg(?:/|$)"),
        regex("(?:^|/)Login Data(?: For Account)?$"), regex("(?:^|/)logins\\.json$"), regex("(?:^|/)key[34]\\.db$"),
        regex("(?:^|/)\\.netrc$"), regex("(?:^|/)\\.aws/credentials$"), regex("(?:^|/)\\.git-credentials$"),
        regex("(?:^|/)\\.docker/config\\.json$"), regex("1Password|Bitwarden|KeePass", caseInsensitive: true)]

    // 读密码、改系统设置的命令（与 lanes.ts 的 PRIVILEGED_COMMANDS 一致）。
    private static let privilegedCommands = [
        regex("\\bsecurity\\s+(?:find-(?:generic|internet|certificate|key)|dump-keychain|export|unlock-keychain"
            + "|(?:add|delete)-(?:generic|internet)-password|set-keychain)"),
        regex("(?:^|[\\s;&|(])sudo\\b"), regex("\\bdefaults\\s+(?:-currentHost\\s+)?(?:write|delete|import|rename)\\b"),
        regex("\\bsystemsetup\\b"), regex("\\btccutil\\b"), regex("\\bspctl\\b"), regex("\\bcsrutil\\b"),
        regex("\\bfdesetup\\b"), regex("\\bnvram\\b"), regex("\\bdscl\\b"), regex("\\bnetworksetup\\s+-set"),
        regex("\\bpmset\\b"), regex("\\bscutil\\s+--set\\b"), regex("\\bkextload\\b"),
        regex("\\bprofiles\\s+(?:install|remove)"),
        regex("\\blaunchctl\\s+(?:load|unload|bootstrap|bootout|enable|disable)\\b"),
        regex("x-apple\\.systempreferences"), regex("System (?:Settings|Preferences)")]

    private static let settingsApps = regex("^(?:System Settings|System Preferences|系统设置|系统偏好设置"
        + "|com\\.apple\\.systempreferences|com\\.apple\\.Settings|Keychain Access|钥匙串访问"
        + "|com\\.apple\\.keychainaccess|Passwords|密码|com\\.apple\\.Passwords)(?:\\.app)?$", caseInsensitive: true)

    /// 前台应用是否属于系统设置 / 密码管理（input_click 判道用）。
    static func isSettingsApp(_ identifier: String) -> Bool {
        matches(settingsApps, identifier.trimmingCharacters(in: .whitespaces))
    }

    /// 只凭参数判这个动作走哪条道；input_click 需要外部告知前台是不是系统设置。
    static func classify(_ params: ActionParams, inSettingsApp: Bool) -> DeviceLane {
        if payment(params) { return .deny }
        if secret(params, inSettingsApp: inSettingsApp) { return .confirm }
        return .allow
    }

    private static func payment(_ params: ActionParams) -> Bool {
        switch params.kind {
        case .browserOpen, .tabOpen, .tabNavigate: return paymentUrl(params.url ?? "")
        case .inputType: return hasCardNumber(params.text ?? "")
        case .tabClick:
            let words = [params.selector, params.text].compactMap { $0 }
            return words.contains { matches(paymentTarget, $0) || matches(paymentWords, $0) }
        case .tabFill: return hasCardNumber(params.value ?? "") || matches(cardField, params.selector ?? "")
        // 第 3 批 tab_act：提交（含付款）由注入脚本按真实元素拦、等他在卡上定（不关死）；像卡号的字照旧关死。
        case .tabAct: return params.act?.op == "fill" && hasCardNumber(params.act?.value ?? "")
        case .runCommand: return paymentCommand(params.command ?? "")
        default: return false
        }
    }

    private static func secret(_ params: ActionParams, inSettingsApp: Bool) -> Bool {
        switch params.kind {
        case .fileList, .fileRead, .fileWrite, .fileDelete:
            return secretPaths.contains { matches($0, params.path ?? "") }
        case .runCommand:
            let command = params.command ?? ""
            if privilegedCommands.contains(where: { matches($0, command) }) { return true }
            return secretPaths.contains { matches($0, command) }
        case .appOpen: return isSettingsApp(params.app ?? "")
        case .inputClick: return inSettingsApp
        case .tabFill: return matches(passwordField, params.selector ?? "")
        default: return false
        }
    }

    /// 网页标签里要点 / 要填的那个元素，按真实 DOM 再判一次（设备侧最后一道墙，判不准从严）：
    /// 付款页面、提交到付款地址的表单、像付款下单的按钮、卡号框关死；密码框、表单里有密码框要你点。
    static func classifyTarget(_ facts: TabTargetFacts, kind: ActionKind, value: String?) -> DeviceLane {
        if paymentPage(facts.pageUrl) || (!facts.formAction.isEmpty && paymentPage(facts.formAction)) { return .deny }
        switch kind {
        case .tabClick:
            if matches(paymentTarget, facts.label) || matches(paymentWords, facts.label) { return .deny }
        case .tabFill:
            let field = [facts.autocomplete, facts.name].joined(separator: " ")
            if matches(cardField, field) || facts.autocomplete.lowercased().hasPrefix("cc-")
                || hasCardNumber(value ?? "") { return .deny }
        default: break
        }
        return facts.isPassword || facts.formHasPassword ? .confirm : .allow
    }

    /// 网页翻译（0.4.0）：这一页是不是付款类页面，和网页标签动作的页面判法同一套；付款页不翻。
    static func isPaymentPage(_ address: String) -> Bool { paymentPage(address) }

    /// 已经打开着的页面是不是付款页（解析不了的地址这里不当付款页：它已经是用户自己打开着的页面了）。
    private static func paymentPage(_ address: String) -> Bool {
        guard URLComponents(string: address)?.host != nil else { return false }
        return paymentUrl(address)
    }

    private static func paymentCommand(_ command: String) -> Bool {
        if matches(paymentSchemes, command) { return true }
        return urls(in: command).contains { paymentUrl($0) }
    }

    private static func paymentUrl(_ address: String) -> Bool {
        // 解析不了的网址判不准，按更严的道（当作付款）。
        guard let parsed = URLComponents(string: address), let host = parsed.host?.lowercased() else { return true }
        if paymentHosts.contains(where: { host == $0 || host.hasSuffix("." + $0) }) { return true }
        return matches(paymentPath, parsed.percentEncodedPath.isEmpty ? "/" : parsed.percentEncodedPath)
    }

    private static func hasCardNumber(_ text: String) -> Bool {
        let scanner = cardNumber
        let range = NSRange(text.startIndex..., in: text)
        for match in scanner.matches(in: text, range: range) {
            guard let span = Range(match.range, in: text) else { continue }
            let digits = String(text[span]).filter(\.isNumber)
            if (13...19).contains(digits.count), luhn(digits) { return true }
        }
        return false
    }

    private static func luhn(_ digits: String) -> Bool {
        var sum = 0
        for (index, character) in digits.reversed().enumerated() {
            guard var digit = character.wholeNumberValue else { return false }
            if index % 2 == 1 {
                digit *= 2
                if digit > 9 { digit -= 9 }
            }
            sum += digit
        }
        return sum % 10 == 0
    }

    private static func urls(in command: String) -> [String] {
        let range = NSRange(command.startIndex..., in: command)
        return httpUrl.matches(in: command, range: range).compactMap { match in
            Range(match.range, in: command).map { String(command[$0]) }
        }
    }

    private static func matches(_ expression: NSRegularExpression, _ text: String) -> Bool {
        expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    private static func regex(_ pattern: String, caseInsensitive: Bool = false) -> NSRegularExpression {
        // These patterns are fixed literals, so compilation cannot fail at runtime.
        let options: NSRegularExpression.Options = caseInsensitive ? [.caseInsensitive] : []
        return try! NSRegularExpression(pattern: pattern, options: options)
    }
}

/// 要点 / 要填的元素在页面上的事实，由 DOM 脚本读出（web-tab-dom.swift）。
struct TabTargetFacts: Decodable, Equatable {
    let pageUrl: String
    /// 元素上看得见的字、aria-label、title、name、id 合在一起（密码框不含值）。
    let label: String
    let name: String
    let autocomplete: String
    let formAction: String
    let isPassword: Bool
    let formHasPassword: Bool
}
