// hooks/useWithdrawCountries.ts
// Drop this file in your hooks/ directory and import wherever needed.
// No state, no effects — just stable reference data exported as a hook
// so it slots naturally into React's import patterns and stays tree-shakeable.

export type WithdrawMethodKey = "momo" | "bank" | "eth" | "binance" | "usdt_trc20";

export interface WithdrawCountry {
    name: string;
    code: string;       // ISO 3166-1 alpha-2
    flag: string;       // emoji
    dialCode: string;
    currency: string;
    methods: WithdrawMethodKey[];
    operators: Partial<Record<WithdrawMethodKey, string[]>>;
    phoneDigits: number;
}

const COUNTRIES: WithdrawCountry[] = [
    // ── West Africa ──────────────────────────────────────────────────────────
    {
        name: "Ghana", code: "GH", flag: "🇬🇭", dialCode: "+233", currency: "GHS",
        methods: ["momo", "bank", "eth", "binance", "usdt_trc20"],
        operators: {
            momo: ["MTN MoMo", "Telecel Cash", "AirtelTigo Money"],
            bank: ["GCB Bank", "Absa Ghana", "Stanbic Bank", "Ecobank Ghana",
                "Fidelity Bank", "Access Bank", "Zenith Bank GH", "CalBank", "UBA Ghana"],
        },
        phoneDigits: 9,
    },
    {
        name: "Nigeria", code: "NG", flag: "🇳🇬", dialCode: "+234", currency: "NGN",
        methods: ["momo", "bank", "eth", "binance", "usdt_trc20"],
        operators: {
            momo: ["OPay", "PalmPay", "MTN MoMo NG", "Kuda", "Moniepoint"],
            bank: ["GTBank", "Access Bank NG", "Zenith Bank NG", "UBA Nigeria",
                "First Bank NG", "Stanbic IBTC", "Ecobank Nigeria", "Wema Bank"],
        },
        phoneDigits: 10,
    },
    {
        name: "Côte d'Ivoire", code: "CI", flag: "🇨🇮", dialCode: "+225", currency: "XOF",
        methods: ["momo", "bank", "usdt_trc20"],
        operators: {
            momo: ["Orange Money", "MTN MoMo CI", "Wave", "Moov Money"],
            bank: ["Ecobank CI", "SGBCI", "BICICI", "Coris Bank"],
        },
        phoneDigits: 10,
    },
    {
        name: "Senegal", code: "SN", flag: "🇸🇳", dialCode: "+221", currency: "XOF",
        methods: ["momo", "bank", "usdt_trc20"],
        operators: {
            momo: ["Orange Money", "Wave", "Free Money", "Wizall"],
            bank: ["CBAO", "Ecobank Senegal", "BHS", "UBA Senegal"],
        },
        phoneDigits: 9,
    },
    {
        name: "Cameroon", code: "CM", flag: "🇨🇲", dialCode: "+237", currency: "XAF",
        methods: ["momo", "bank", "usdt_trc20"],
        operators: {
            momo: ["MTN MoMo CM", "Orange Money CM"],
            bank: ["Afriland First Bank", "BICEC", "Ecobank Cameroon", "UBA Cameroon"],
        },
        phoneDigits: 9,
    },
    // ── East / Southern Africa ───────────────────────────────────────────────
    {
        name: "Kenya", code: "KE", flag: "🇰🇪", dialCode: "+254", currency: "KES",
        methods: ["momo", "bank", "eth", "binance", "usdt_trc20"],
        operators: {
            momo: ["M-Pesa", "Airtel Money KE", "T-Kash"],
            bank: ["Equity Bank", "KCB Bank", "Co-operative Bank", "NCBA Bank", "Absa Kenya"],
        },
        phoneDigits: 9,
    },
    {
        name: "Tanzania", code: "TZ", flag: "🇹🇿", dialCode: "+255", currency: "TZS",
        methods: ["momo", "bank", "usdt_trc20"],
        operators: {
            momo: ["M-Pesa TZ", "Airtel Money TZ", "Tigo Pesa", "Halopesa"],
            bank: ["CRDB Bank", "NMB Bank", "Stanbic Tanzania", "Equity Bank TZ"],
        },
        phoneDigits: 9,
    },
    {
        name: "Uganda", code: "UG", flag: "🇺🇬", dialCode: "+256", currency: "UGX",
        methods: ["momo", "bank", "usdt_trc20"],
        operators: {
            momo: ["MTN MoMo UG", "Airtel Money UG"],
            bank: ["Stanbic Uganda", "Equity Bank UG", "DFCU Bank", "Centenary Bank"],
        },
        phoneDigits: 9,
    },
    {
        name: "Rwanda", code: "RW", flag: "🇷🇼", dialCode: "+250", currency: "RWF",
        methods: ["momo", "bank", "usdt_trc20"],
        operators: {
            momo: ["MTN MoMo RW", "Airtel Money RW"],
            bank: ["Bank of Kigali", "Equity Bank RW", "KCB Rwanda", "I&M Bank RW"],
        },
        phoneDigits: 9,
    },
    {
        name: "Ethiopia", code: "ET", flag: "🇪🇹", dialCode: "+251", currency: "ETB",
        methods: ["momo", "bank"],
        operators: {
            momo: ["Telebirr"],
            bank: ["Commercial Bank of Ethiopia", "Awash Bank", "Dashen Bank", "Abyssinia Bank"],
        },
        phoneDigits: 9,
    },
    {
        name: "Zambia", code: "ZM", flag: "🇿🇲", dialCode: "+260", currency: "ZMW",
        methods: ["momo", "bank", "usdt_trc20"],
        operators: {
            momo: ["MTN MoMo ZM", "Airtel Money ZM", "Zamtel Kwacha"],
            bank: ["Zanaco", "Stanbic Zambia", "Absa Zambia", "FNB Zambia"],
        },
        phoneDigits: 9,
    },
    {
        name: "Zimbabwe", code: "ZW", flag: "🇿🇼", dialCode: "+263", currency: "USD",
        methods: ["momo", "bank", "usdt_trc20"],
        operators: {
            momo: ["EcoCash", "OneMoney", "Telecash"],
            bank: ["CBZ Bank", "FBC Bank", "Stanbic Zimbabwe", "ZB Bank"],
        },
        phoneDigits: 9,
    },
    {
        name: "Mozambique", code: "MZ", flag: "🇲🇿", dialCode: "+258", currency: "MZN",
        methods: ["momo", "bank"],
        operators: {
            momo: ["M-Pesa MZ", "e-Mola", "mKesh"],
            bank: ["BCI", "BIM", "Standard Bank MZ"],
        },
        phoneDigits: 9,
    },
    {
        name: "South Africa", code: "ZA", flag: "🇿🇦", dialCode: "+27", currency: "ZAR",
        methods: ["bank", "eth", "binance", "usdt_trc20"],
        operators: {
            bank: ["FNB", "Standard Bank SA", "ABSA SA", "Nedbank", "Capitec", "Discovery Bank"],
        },
        phoneDigits: 9,
    },
    // ── North Africa ─────────────────────────────────────────────────────────
    {
        name: "Egypt", code: "EG", flag: "🇪🇬", dialCode: "+20", currency: "EGP",
        methods: ["momo", "bank", "usdt_trc20"],
        operators: {
            momo: ["Vodafone Cash", "Orange Money EG", "Etisalat Cash", "Fawry"],
            bank: ["CIB Egypt", "NBE", "Banque Misr", "QNB Egypt", "HSBC Egypt"],
        },
        phoneDigits: 10,
    },
    {
        name: "Morocco", code: "MA", flag: "🇲🇦", dialCode: "+212", currency: "MAD",
        methods: ["bank", "usdt_trc20"],
        operators: {
            bank: ["Attijariwafa Bank", "CIH Bank", "BMCE Bank", "Banque Populaire", "Société Générale MA"],
        },
        phoneDigits: 9,
    },
    // ── Middle East ──────────────────────────────────────────────────────────
    {
        name: "UAE", code: "AE", flag: "🇦🇪", dialCode: "+971", currency: "AED",
        methods: ["bank", "eth", "binance", "usdt_trc20"],
        operators: {
            bank: ["Emirates NBD", "FAB", "ADCB", "Dubai Islamic Bank", "Mashreq"],
        },
        phoneDigits: 9,
    },
    {
        name: "Saudi Arabia", code: "SA", flag: "🇸🇦", dialCode: "+966", currency: "SAR",
        methods: ["bank", "usdt_trc20"],
        operators: {
            bank: ["Al Rajhi Bank", "SNB", "Riyad Bank", "SABB", "Alinma Bank"],
        },
        phoneDigits: 9,
    },
    {
        name: "Qatar", code: "QA", flag: "🇶🇦", dialCode: "+974", currency: "QAR",
        methods: ["bank", "usdt_trc20"],
        operators: {
            bank: ["QNB", "Commercial Bank Qatar", "Doha Bank", "Masraf Al Rayan"],
        },
        phoneDigits: 8,
    },
    {
        name: "Kuwait", code: "KW", flag: "🇰🇼", dialCode: "+965", currency: "KWD",
        methods: ["bank", "usdt_trc20"],
        operators: {
            bank: ["NBK", "KFH", "Burgan Bank", "Gulf Bank Kuwait"],
        },
        phoneDigits: 8,
    },
    {
        name: "Jordan", code: "JO", flag: "🇯🇴", dialCode: "+962", currency: "JOD",
        methods: ["momo", "bank", "usdt_trc20"],
        operators: {
            momo: ["Zain Cash", "Orange Money JO", "Umniah e-Dinar"],
            bank: ["Arab Bank", "Housing Bank", "Jordan Ahli Bank", "Cairo Amman Bank"],
        },
        phoneDigits: 9,
    },
    // ── South Asia ───────────────────────────────────────────────────────────
    {
        name: "India", code: "IN", flag: "🇮🇳", dialCode: "+91", currency: "INR",
        methods: ["momo", "bank", "eth", "binance", "usdt_trc20"],
        operators: {
            momo: ["PhonePe", "Google Pay", "Paytm", "BHIM UPI"],
            bank: ["SBI", "HDFC Bank", "ICICI Bank", "Axis Bank", "Kotak Bank"],
        },
        phoneDigits: 10,
    },
    {
        name: "Pakistan", code: "PK", flag: "🇵🇰", dialCode: "+92", currency: "PKR",
        methods: ["momo", "bank", "usdt_trc20"],
        operators: {
            momo: ["JazzCash", "Easypaisa", "SadaPay", "Nayapay"],
            bank: ["HBL", "MCB Bank", "UBL", "Meezan Bank", "Bank Alfalah"],
        },
        phoneDigits: 10,
    },
    {
        name: "Bangladesh", code: "BD", flag: "🇧🇩", dialCode: "+880", currency: "BDT",
        methods: ["momo", "bank", "usdt_trc20"],
        operators: {
            momo: ["bKash", "Nagad", "Rocket", "Upay"],
            bank: ["Dutch-Bangla Bank", "BRAC Bank", "Islami Bank BD", "City Bank BD"],
        },
        phoneDigits: 10,
    },
    // ── Southeast Asia ───────────────────────────────────────────────────────
    {
        name: "Philippines", code: "PH", flag: "🇵🇭", dialCode: "+63", currency: "PHP",
        methods: ["momo", "bank", "eth", "binance", "usdt_trc20"],
        operators: {
            momo: ["GCash", "Maya (PayMaya)", "ShopeePay"],
            bank: ["BDO", "BPI", "Metrobank", "LandBank", "UnionBank PH"],
        },
        phoneDigits: 10,
    },
    {
        name: "Indonesia", code: "ID", flag: "🇮🇩", dialCode: "+62", currency: "IDR",
        methods: ["momo", "bank", "usdt_trc20"],
        operators: {
            momo: ["GoPay", "OVO", "DANA", "ShopeePay ID"],
            bank: ["BCA", "BNI", "BRI", "Mandiri", "CIMB Niaga"],
        },
        phoneDigits: 10,
    },
    {
        name: "Vietnam", code: "VN", flag: "🇻🇳", dialCode: "+84", currency: "VND",
        methods: ["momo", "bank", "usdt_trc20"],
        operators: {
            momo: ["MoMo VN", "ZaloPay", "VNPay"],
            bank: ["Vietcombank", "Techcombank", "MB Bank", "BIDV", "VPBank"],
        },
        phoneDigits: 9,
    },
    {
        name: "Malaysia", code: "MY", flag: "🇲🇾", dialCode: "+60", currency: "MYR",
        methods: ["momo", "bank", "eth", "binance", "usdt_trc20"],
        operators: {
            momo: ["Touch 'n Go eWallet", "GrabPay MY", "Boost", "MAE"],
            bank: ["Maybank", "CIMB Malaysia", "Public Bank", "RHB Bank", "Hong Leong Bank"],
        },
        phoneDigits: 9,
    },
    {
        name: "Thailand", code: "TH", flag: "🇹🇭", dialCode: "+66", currency: "THB",
        methods: ["momo", "bank", "usdt_trc20"],
        operators: {
            momo: ["PromptPay", "TrueMoney Wallet", "Rabbit LINE Pay"],
            bank: ["Bangkok Bank", "Kasikorn Bank", "SCB", "Krungthai Bank", "TMBThanachart"],
        },
        phoneDigits: 9,
    },
    // ── East Asia / Pacific ───────────────────────────────────────────────────
    {
        name: "Singapore", code: "SG", flag: "🇸🇬", dialCode: "+65", currency: "SGD",
        methods: ["bank", "eth", "binance", "usdt_trc20"],
        operators: {
            bank: ["DBS", "OCBC", "UOB", "Standard Chartered SG", "HSBC SG"],
        },
        phoneDigits: 8,
    },
    {
        name: "Hong Kong", code: "HK", flag: "🇭🇰", dialCode: "+852", currency: "HKD",
        methods: ["bank", "eth", "binance", "usdt_trc20"],
        operators: {
            bank: ["HSBC HK", "Bank of China HK", "Hang Seng Bank", "Standard Chartered HK"],
        },
        phoneDigits: 8,
    },
    {
        name: "Japan", code: "JP", flag: "🇯🇵", dialCode: "+81", currency: "JPY",
        methods: ["bank", "eth", "binance", "usdt_trc20"],
        operators: {
            bank: ["Japan Post Bank", "MUFG Bank", "Sumitomo Mitsui", "Mizuho Bank", "Rakuten Bank"],
        },
        phoneDigits: 10,
    },
    {
        name: "South Korea", code: "KR", flag: "🇰🇷", dialCode: "+82", currency: "KRW",
        methods: ["bank", "eth", "binance", "usdt_trc20"],
        operators: {
            bank: ["KB Kookmin", "Shinhan Bank", "Woori Bank", "Hana Bank", "Kakao Bank"],
        },
        phoneDigits: 10,
    },
    {
        name: "China", code: "CN", flag: "🇨🇳", dialCode: "+86", currency: "CNY",
        // Crypto explicitly excluded — domestically banned
        methods: ["momo", "bank"],
        operators: {
            momo: ["Alipay", "WeChat Pay"],
            bank: ["ICBC", "China Construction Bank", "Agricultural Bank", "Bank of China", "China Merchants Bank"],
        },
        phoneDigits: 11,
    },
    // ── Europe ───────────────────────────────────────────────────────────────
    {
        name: "United Kingdom", code: "GB", flag: "🇬🇧", dialCode: "+44", currency: "GBP",
        methods: ["bank", "eth", "binance", "usdt_trc20"],
        operators: {
            bank: ["Barclays", "HSBC UK", "Lloyds Bank", "NatWest", "Santander UK", "Monzo", "Revolut UK"],
        },
        phoneDigits: 10,
    },
    {
        name: "Germany", code: "DE", flag: "🇩🇪", dialCode: "+49", currency: "EUR",
        methods: ["bank", "eth", "binance", "usdt_trc20"],
        operators: {
            bank: ["Deutsche Bank", "Commerzbank", "Sparkasse", "DKB", "N26"],
        },
        phoneDigits: 10,
    },
    {
        name: "France", code: "FR", flag: "🇫🇷", dialCode: "+33", currency: "EUR",
        methods: ["bank", "eth", "binance", "usdt_trc20"],
        operators: {
            bank: ["BNP Paribas", "Crédit Agricole", "Société Générale", "LCL", "Boursorama"],
        },
        phoneDigits: 9,
    },
    {
        name: "Spain", code: "ES", flag: "🇪🇸", dialCode: "+34", currency: "EUR",
        methods: ["bank", "eth", "binance", "usdt_trc20"],
        operators: {
            bank: ["Santander ES", "BBVA", "CaixaBank", "Sabadell", "ING Spain"],
        },
        phoneDigits: 9,
    },
    {
        name: "Italy", code: "IT", flag: "🇮🇹", dialCode: "+39", currency: "EUR",
        methods: ["bank", "eth", "binance", "usdt_trc20"],
        operators: {
            bank: ["Intesa Sanpaolo", "UniCredit", "Banco BPM", "Banca MPS", "FinecoBank"],
        },
        phoneDigits: 10,
    },
    {
        name: "Netherlands", code: "NL", flag: "🇳🇱", dialCode: "+31", currency: "EUR",
        methods: ["bank", "eth", "binance", "usdt_trc20"],
        operators: {
            bank: ["ING NL", "ABN AMRO", "Rabobank", "Bunq", "ASN Bank"],
        },
        phoneDigits: 9,
    },
    {
        name: "Poland", code: "PL", flag: "🇵🇱", dialCode: "+48", currency: "PLN",
        methods: ["bank", "usdt_trc20"],
        operators: {
            bank: ["PKO BP", "Bank Pekao", "mBank", "ING Bank Śląski", "Santander PL"],
        },
        phoneDigits: 9,
    },
    {
        name: "Sweden", code: "SE", flag: "🇸🇪", dialCode: "+46", currency: "SEK",
        methods: ["bank", "eth", "binance", "usdt_trc20"],
        operators: {
            bank: ["Swedbank", "SEB", "Handelsbanken", "Nordea SE", "Länsförsäkringar Bank"],
        },
        phoneDigits: 9,
    },
    {
        name: "Switzerland", code: "CH", flag: "🇨🇭", dialCode: "+41", currency: "CHF",
        methods: ["bank", "eth", "binance", "usdt_trc20"],
        operators: {
            bank: ["UBS", "PostFinance", "Raiffeisen CH", "Zürcher Kantonalbank"],
        },
        phoneDigits: 9,
    },
    {
        name: "Portugal", code: "PT", flag: "🇵🇹", dialCode: "+351", currency: "EUR",
        methods: ["bank", "usdt_trc20"],
        operators: {
            bank: ["Caixa Geral de Depósitos", "BPI", "Millennium bcp", "Novobanco", "Montepio"],
        },
        phoneDigits: 9,
    },
    {
        name: "Romania", code: "RO", flag: "🇷🇴", dialCode: "+40", currency: "RON",
        methods: ["bank", "usdt_trc20"],
        operators: {
            bank: ["BCR", "BRD", "Banca Transilvania", "ING Romania", "Raiffeisen Romania"],
        },
        phoneDigits: 9,
    },
    {
        name: "Turkey", code: "TR", flag: "🇹🇷", dialCode: "+90", currency: "TRY",
        methods: ["bank", "usdt_trc20"],
        operators: {
            bank: ["Ziraat Bankası", "Garanti BBVA", "İş Bankası", "Yapı Kredi", "Akbank"],
        },
        phoneDigits: 10,
    },
    // ── Americas ─────────────────────────────────────────────────────────────
    {
        name: "United States", code: "US", flag: "🇺🇸", dialCode: "+1", currency: "USD",
        methods: ["bank", "eth", "binance", "usdt_trc20"],
        operators: {
            bank: ["Bank of America", "Chase", "Wells Fargo", "Citibank", "US Bank"],
        },
        phoneDigits: 10,
    },
    {
        name: "Canada", code: "CA", flag: "🇨🇦", dialCode: "+1", currency: "CAD",
        methods: ["bank", "eth", "binance", "usdt_trc20"],
        operators: {
            bank: ["RBC", "TD Bank", "Scotiabank", "BMO", "CIBC"],
        },
        phoneDigits: 10,
    },
    {
        name: "Brazil", code: "BR", flag: "🇧🇷", dialCode: "+55", currency: "BRL",
        methods: ["momo", "bank", "usdt_trc20"],
        operators: {
            momo: ["PIX", "PicPay", "Mercado Pago BR"],
            bank: ["Nubank", "Itaú", "Bradesco", "Banco do Brasil", "Santander BR"],
        },
        phoneDigits: 11,
    },
    {
        name: "Mexico", code: "MX", flag: "🇲🇽", dialCode: "+52", currency: "MXN",
        methods: ["bank", "usdt_trc20"],
        operators: {
            bank: ["BBVA Mexico", "Banorte", "HSBC Mexico", "Scotiabank MX", "Santander MX"],
        },
        phoneDigits: 10,
    },
    {
        name: "Argentina", code: "AR", flag: "🇦🇷", dialCode: "+54", currency: "ARS",
        // USDT retained — actively used as inflation hedge locally
        methods: ["bank", "usdt_trc20"],
        operators: {
            bank: ["Banco Nación", "Galicia", "BBVA Argentina", "Santander AR", "Naranja X"],
        },
        phoneDigits: 10,
    },
    {
        name: "Colombia", code: "CO", flag: "🇨🇴", dialCode: "+57", currency: "COP",
        methods: ["momo", "bank", "usdt_trc20"],
        operators: {
            momo: ["Nequi", "Daviplata"],
            bank: ["Bancolombia", "Davivienda", "BBVA Colombia", "Banco de Bogotá", "Itaú Colombia"],
        },
        phoneDigits: 10,
    },
    {
        name: "Chile", code: "CL", flag: "🇨🇱", dialCode: "+56", currency: "CLP",
        methods: ["bank", "usdt_trc20"],
        operators: {
            bank: ["Banco Estado", "Santander CL", "BCI", "Banco de Chile", "BBVA Chile"],
        },
        phoneDigits: 9,
    },
    {
        name: "Peru", code: "PE", flag: "🇵🇪", dialCode: "+51", currency: "PEN",
        methods: ["momo", "bank", "usdt_trc20"],
        operators: {
            momo: ["Yape", "Plin"],
            bank: ["BCP", "Interbank", "BBVA Peru", "Scotiabank PE", "Banco de la Nación"],
        },
        phoneDigits: 9,
    },
    // ── Oceania ──────────────────────────────────────────────────────────────
    {
        name: "Australia", code: "AU", flag: "🇦🇺", dialCode: "+61", currency: "AUD",
        methods: ["bank", "eth", "binance", "usdt_trc20"],
        operators: {
            bank: ["Commonwealth Bank", "Westpac", "ANZ", "NAB", "Macquarie Bank"],
        },
        phoneDigits: 9,
    },
    {
        name: "New Zealand", code: "NZ", flag: "🇳🇿", dialCode: "+64", currency: "NZD",
        methods: ["bank", "usdt_trc20"],
        operators: {
            bank: ["ANZ NZ", "Westpac NZ", "BNZ", "ASB Bank", "Kiwibank"],
        },
        phoneDigits: 9,
    },
];

/**
 * useWithdrawCountries
 *
 * Returns a stable reference to the full country list.
 * No state or effects — the array is module-level so it's allocated once
 * and the same reference is returned on every call (safe for useMemo deps).
 *
 * Usage:
 *   const countries = useWithdrawCountries();
 *   const [selected, setSelected] = useState(countries[0]);
 */
export function useWithdrawCountries(): WithdrawCountry[] {
    return COUNTRIES;
}

/** Convenience: look up a single country by ISO code. */
export function useWithdrawCountry(code: string): WithdrawCountry | undefined {
    return COUNTRIES.find((c) => c.code === code);
}
