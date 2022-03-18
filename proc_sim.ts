abstract class ReadOnlyBus {
    readonly size: number
    readonly maxValue: number
    protected value: number = 0
    protected dirty: boolean = false

    constructor(size: number) {
        if (size > 31) {
            console.warn(`W:\tMax buss size of 31 bits due to arithmetic limitations.`)
            size = 31
        }

        this.size = size
        this.maxValue = 2**size - 1
    }

    public isDirty(): boolean {
        return this.dirty;
    }

    public clean() {
        this.dirty = false
    }

    public getValue(): number {
        return this.value
    }
}

class Bus extends ReadOnlyBus {

    public setValue(value: number) {
        if (this.isDirty()) {
            console.warn(`W:\tBus already modified this phase!`)
        }
        if (!Number.isInteger(value)) {
            console.warn(`W:\tInteger expected, found float (${value}) - rounding down`)
            value = Math.floor(value)
        }
        if (value > this.maxValue) {
            console.warn(`W:\tValue (${value}) larger than maximum (${this.maxValue}) - truncating.`)
            value = value & this.maxValue
        }

        this.value = value
        this.dirty = true
    }

    public getValue(): number {
        return this.value
    }
}

const CTRL_SET = 0b001
const CTRL_ENB = 0b010
const CTRL_INC = 0b100 // only used by program counter
class Register extends ReadOnlyBus {
    public readonly dataBus: Bus
    public readonly controlBus: Bus
    public readonly name: string

    public constructor(size: number, name: string, inputBus: Bus, controlBus: Bus) {
        super(size)

        this.name = name

        this.dataBus = inputBus
        this.controlBus = controlBus
    }

    public update_enable() {
        if (this.controlBus.getValue() & CTRL_ENB) {
            this.dataBus.setValue(this.value)
        }
    }

    public update_set() {
        let ctrl = this.controlBus.getValue()
        if (ctrl & CTRL_SET) {
            this.value = this.dataBus.getValue()
            this.dirty = true
        } else if (ctrl & CTRL_INC && !this.isDirty()) {
            this.value = (this.value + 1) % (1 << this.size)
            this.dirty = true
        }
    }
}

const ALU_ADD  = 0b001
const ALU_SUB  = 0b010
const ALU_AND  = 0b011
const ALU_OR   = 0b100
const ALU_XOR  = 0b101
const ALU_NOT  = 0b110
const ALU_INSTRUCTIONS = {
    "add": ALU_ADD,
    "sub": ALU_SUB,
    "and": ALU_AND,
    "ior": ALU_OR,
    "xor": ALU_XOR,
    "not": ALU_NOT
}

const FLGS_Z = 0b1000
const FLGS_S = 0b0100
const FLGS_O = 0b0010
const FLGS_C = 0b0001
class ArithmeticLogicUnit extends ReadOnlyBus {
    private readonly inputT1: ReadOnlyBus
    private readonly inputT2: ReadOnlyBus

    private readonly dataBus: Bus
    private readonly controlBus: ReadOnlyBus

    public constructor(t1: ReadOnlyBus, t2: ReadOnlyBus, dataBus: Bus, controlBus: ReadOnlyBus) {
        super(4)
        this.inputT1 = t1
        this.inputT2 = t2
        this.dataBus = dataBus

        this.controlBus = controlBus

        // this.value = flags
    }


    public update() {
        let op = this.controlBus.getValue()
        if (!op) { // control not set
            return
        }

        let a = this.inputT1.getValue()
        let signA: number = +((a & (1<<(this.inputT1.size-1))) != 0)

        let b = this.inputT2.getValue()
        let signB: number = +((b & (1<<(this.inputT2.size-1))) != 0)

        let res: number = 0
        let flgs = 0b0000

        switch (op & 0b111) {
            case ALU_ADD:
                res = a + b
                break
            case ALU_SUB:
                res = a - b
                break
            case ALU_AND:
                res = a & b
                break
            case ALU_OR:
                res = a | b
                break
            case ALU_XOR:
                res = a ^ b
                break
            case ALU_NOT:
                res = (~a) & this.dataBus.maxValue
                break

        }

        if (res > this.dataBus.maxValue) {
            res -= this.dataBus.maxValue
            flgs |= FLGS_C // 1 << 0 // set carry flag
        }
        let signRes = (res & (1 << (this.dataBus.size - 1))) > 0 ? 1 : 0
        flgs |= signRes ? FLGS_S : 0 // set sign flag

        if (signA === signB) {
            flgs |= (signA ^ signRes) ? FLGS_O : 0 // (signRes ^ signA) << 1 // set overflow flag
        }

        if (res === 0) {
            flgs |= FLGS_Z // 1 << 3 // set zero flag
        }
        this.dataBus.setValue(res)
        this.value = flgs
        this.dirty = true
    }
}

const RAM_READ = 0b001
const RAM_WRITE = 0b010
const RAM_INSTRUCTIONS = {
    "load": RAM_READ,
    "save": RAM_WRITE
}

class RAM {
    private controlBus: ReadOnlyBus
    private addressBus: ReadOnlyBus

    private dataBus: Bus

    public readonly data: number[]

    public constructor(wordSize: number, controlBus: ReadOnlyBus, addressBus: ReadOnlyBus, dataBus: Bus) {
        this.controlBus = controlBus
        this.addressBus = addressBus
        this.dataBus = dataBus
        this.data = Array.from({length: (1<<wordSize)}, () => 0)
    }

    public update() {
        let address = this.addressBus.getValue()
        let value: number
        switch (this.controlBus.getValue()) {
            case CTRL_ENB:
                value = this.data[address]
                this.dataBus.setValue(value)
                break
            case CTRL_SET:
                value = this.dataBus.getValue()
                this.data[address] = value
                break
            default: // No control or invalid control state
                break
        }
    }
}

const INS_RAM = 0b00
const INS_B_RAM_READ = 0b001
const INS_B_RAM_WRITE = 0b100

const INS_ALU_R = 0b01

const INS_ALU_I = 0b11

const INS_JMP = 0b10
const INS_JMP_JMP = 0b000
const INS_JMP_JLZ = 0b001
const INS_JMP_JGZ = 0b010
const INS_JMP_JEZ = 0b011
const JMP_INSTRUCTIONS = {
    "jmp": INS_JMP_JMP,
    "jlz": INS_JMP_JLZ,
    "jgz": INS_JMP_JGZ,
    "jez": INS_JMP_JEZ
}

type funcFunc = () => funcFunc
class Decoder {
    private instructionControl: Bus
    private instructionBus: ReadOnlyBus
    private programControl: Bus // three lines [increment 0b100, enable 0b010, set 0b001]
    private ramControl: Bus
    private registerAControl: Bus
    private registerBControl: Bus
    private registerT1Control: Bus
    private registerT2Control: Bus
    private addressControl: Bus
    private aluControl: Bus
    private flags: ReadOnlyBus

    private currentInstruction: funcFunc = this.fetch_step1
    public readonly currentStep = () =>this.currentInstruction.name


    private fetch_step1(): funcFunc {
        this.programControl.setValue(CTRL_ENB)
        this.addressControl.setValue(CTRL_SET)
        return this.fetch_step2
    }

    private fetch_step2(): funcFunc {
        this.programControl.setValue(CTRL_INC)
        this.addressControl.setValue(0)
        return this.fetch_step3
    }

    private fetch_step3(): funcFunc {
        this.programControl.setValue(0)
        this.ramControl.setValue(CTRL_ENB)
        this.instructionControl.setValue(CTRL_SET)
        return this.fetch_step4
    }

    private fetch_step4(): funcFunc {
        this.ramControl.setValue(0)
        this.instructionControl.setValue(0)
        return this.execute
    }

    private execute(): funcFunc {
        // instructions built as TT III SS D (T->Type, I->Instruction, S->Source, D->Destination)
        let ins = this.instructionBus.getValue()
        let ins_type = ins >> 6 // get only type bits from instruction

        if (ins == 0) {
            return this.fetch_step1()
        }
        switch (ins_type & 0b11) {
            case INS_RAM:
                return this.execute_ram_step1()
            case INS_ALU_I:
                return this.execute_alui_step1()
            case INS_ALU_R:
                return this.execute_alur_step1()
            case INS_JMP:
                return this.execute_jump()
        }
        return this.fetch_step1()
    }

    private execute_ram_step1(): funcFunc {
        let ins = this.instructionBus.getValue()
        let ins_immediate = 1 & (ins >> 2) // 1 if immediate, 0 if register
        let ins_src_reg = 1 & (ins >> 1) // 0 for A, 1 for B
        if (ins_immediate) {
            this.programControl.setValue(CTRL_ENB)
        } else if (ins_src_reg === 0) {
            this.registerAControl.setValue(CTRL_ENB)
        } else {
            this.registerBControl.setValue(CTRL_ENB)
        }
        this.addressControl.setValue(CTRL_SET)
        return this.execute_ram_step2
    }

    private execute_ram_step2(): funcFunc {
        let ins = this.instructionBus.getValue()
        let ins_immediate = 1 & (ins >> 2) // 1 if immediate, 0 if register
        if (ins_immediate) {
            this.programControl.setValue(CTRL_INC)
        } else {
            this.registerAControl.setValue(0)
            this.registerBControl.setValue(0)
        }
        this.addressControl.setValue(0)
        return this.execute_ram_step3
    }

    private execute_ram_step3(): funcFunc {
        let ins = this.instructionBus.getValue()
        let ins_dest_reg = 1 & (ins >> 0) // 0 for A, 1 for B
        let ins_body = 0b111 & (ins >> 3)
        this.programControl.setValue(0) // just in case

        let ramRW: number
        let regRW: number
        switch (ins_body) {
            case INS_B_RAM_READ:
                ramRW = CTRL_ENB
                regRW = CTRL_SET
                break
            case INS_B_RAM_WRITE:
            default:
                ramRW = CTRL_SET
                regRW = CTRL_ENB
        }

        this.ramControl.setValue(ramRW)
        if (ins_dest_reg == 0) {
            this.registerAControl.setValue(regRW)
        } else {
            this.registerBControl.setValue(regRW)
        }
        return this.execute_ram_step4
    }

    private execute_ram_step4(): funcFunc {
        this.ramControl.setValue(0)
        this.registerAControl.setValue(0)
        this.registerBControl.setValue(0)
        return this.fetch_step1
    }

    private execute_alui_step1(): funcFunc {
        this.programControl.setValue(CTRL_ENB)
        this.addressControl.setValue(CTRL_SET)
        return this.execute_alui_step2
    }

    private execute_alui_step2(): funcFunc {
        this.programControl.setValue(CTRL_INC)
        this.addressControl.setValue(0)
        return this.execute_alui_step3
    }

    private execute_alui_step3(): funcFunc {
        let ins = this.instructionBus.getValue()
        let ins_t = 1 & (ins >> 2)

        this.programControl.setValue(0)
        this.ramControl.setValue(CTRL_ENB)

        if (ins_t == 0) {
            this.registerT1Control.setValue(CTRL_SET)
        } else {
            this.registerT2Control.setValue(CTRL_SET)
        }

        return this.execute_alui_step4
    }

    private execute_alui_step4(): funcFunc {
        this.ramControl.setValue(0)
        this.registerT1Control.setValue(0)
        this.registerT2Control.setValue(0)

        // "not" only needs one operand
        let ins = this.instructionBus.getValue()
        let ins_body = (ins >> 3) & 0b111
        if (ins_body == ALU_NOT) {
            return this.execute_alu_step7
        }
        return this.execute_alui_step5
    }

    private execute_alui_step5(): funcFunc {
        let ins = this.instructionBus.getValue()
        let ins_t = 1 & (ins >> 2)
        let ins_r = 1 & (ins >> 1)

        if (ins_r == 0) {
            this.registerAControl.setValue(CTRL_ENB)
        } else {
            this.registerBControl.setValue(CTRL_ENB)
        }

        if (ins_t == 0) {
            this.registerT2Control.setValue(CTRL_SET)
        } else {
            this.registerT1Control.setValue(CTRL_SET)
        }

        return this.execute_alui_step6
    }

    private execute_alui_step6(): funcFunc {
        this.registerAControl.setValue(0)
        this.registerBControl.setValue(0)
        this.registerT1Control.setValue(0)
        this.registerT2Control.setValue(0)

        return this.execute_alu_step7
    }

    private execute_alur_step1(): funcFunc {
        let ins = this.instructionBus.getValue()
        let ins_t1 = 1 & (ins >> 2)

        if (ins_t1) {
            this.registerBControl.setValue(CTRL_ENB)
        } else {
            this.registerAControl.setValue(CTRL_ENB)
        }
        this.registerT1Control.setValue(CTRL_SET)

        return this.execute_alur_step2
    }

    private execute_alur_step2(): funcFunc {
        this.registerAControl.setValue(0)
        this.registerBControl.setValue(0)
        this.registerT1Control.setValue(0)

        // "not" only needs one operand
        let ins = this.instructionBus.getValue()
        let ins_body = (ins >> 3) & 0b111
        if (ins_body == ALU_NOT) {
            return this.execute_alu_step7
        }
        return this.execute_alur_step3
    }

    private execute_alur_step3(): funcFunc {
        let ins = this.instructionBus.getValue()
        let ins_t2 = 1 & (ins >> 1)

        if (ins_t2) {
            this.registerBControl.setValue(CTRL_ENB)
        } else {
            this.registerAControl.setValue(CTRL_ENB)
        }
        this.registerT2Control.setValue(CTRL_SET)

        return this.execute_alur_step4
    }

    private execute_alur_step4(): funcFunc {
        this.registerAControl.setValue(0)
        this.registerBControl.setValue(0)
        this.registerT2Control.setValue(0)

        return this.execute_alu_step7
    }

    private execute_alu_step7(): funcFunc {
        let ins = this.instructionBus.getValue()
        let ins_body = 0b111 & (ins >> 3)
        let ins_dest = 1 & ins

        this.aluControl.setValue(ins_body)
        if (ins_dest == 0) {
            this.registerAControl.setValue(CTRL_SET)
        } else {
            this.registerBControl.setValue(CTRL_SET)
        }
        return this.execute_alu_step8
    }

    private execute_alu_step8(): funcFunc {
        this.aluControl.setValue(0)
        this.registerAControl.setValue(0)
        this.registerBControl.setValue(0)
        return this.fetch_step1
    }

    private execute_jump(): funcFunc {
        let ins = this.instructionBus.getValue()
        let ins_body = 0b111 & (ins >> 3)
        let ins_immediate = 1 & (ins >> 2)

        let condition_flag = true
        if (ins_body == INS_JMP_JEZ) {
            if (!(this.flags.getValue() & FLGS_Z)) {
                condition_flag = false
            }
        } else if (ins_body == INS_JMP_JGZ) {
            if ((this.flags.getValue() & FLGS_S) || this.flags.getValue() & FLGS_Z) {
                condition_flag = false
            }
        } else if (ins_body == INS_JMP_JLZ) {
            if (!(this.flags.getValue() & FLGS_S) || this.flags.getValue() & FLGS_Z) {
                condition_flag = false
            }
        }

        if (condition_flag) {
            return this.execute_jump_step1()
        }

        if (ins_immediate) {
            this.programControl.setValue(CTRL_INC)
            return this.execute_jump_step4
        } else {
            return this.fetch_step1()
        }
    }

    private execute_jump_step1(): funcFunc {
        let ins = this.instructionBus.getValue()
        let ins_immediate = 1 & (ins >> 2)
        let ins_register = 1 & (ins >> 1)

        if (ins_immediate) {
            this.programControl.setValue(CTRL_ENB)
            this.addressControl.setValue(CTRL_SET)
            return this.execute_jump_step2
        } else {
            if (ins_register == 0) {
                this.registerAControl.setValue(CTRL_ENB)
            } else {
                this.registerBControl.setValue(CTRL_ENB)
            }
            this.programControl.setValue(CTRL_SET)
            return this.execute_jump_step4
        }
    }

    private execute_jump_step2(): funcFunc {
        this.programControl.setValue(CTRL_INC)
        this.addressControl.setValue(0)
        return this.execute_jump_step3
    }

    private execute_jump_step3(): funcFunc {
        this.ramControl.setValue(CTRL_ENB)
        this.programControl.setValue(CTRL_SET)
        return this.execute_jump_step4
    }

    private execute_jump_step4(): funcFunc {
        this.ramControl.setValue(0)
        this.registerAControl.setValue(0)
        this.registerBControl.setValue(0)
        this.programControl.setValue(0)
        return this.fetch_step1
    }

    public update() {
        this.currentInstruction = this.currentInstruction()
    }

    public constructor(instructionControl: Bus,
                       instructionBus: ReadOnlyBus,
                       programControl: Bus,
                       ramControl: Bus,
                       registerAControl: Bus,
                       registerBControl: Bus,
                       registerT1Control: Bus,
                       registerT2Control: Bus,
                       addressControl: Bus,
                       aluControl: Bus,
                       flags: ReadOnlyBus) {
        this.instructionControl = instructionControl
        this.instructionBus = instructionBus
        this.programControl = programControl
        this.ramControl = ramControl
        this.registerAControl = registerAControl
        this.registerBControl = registerBControl
        this.registerT1Control = registerT1Control
        this.registerT2Control = registerT2Control
        this.addressControl = addressControl
        this.aluControl = aluControl
        this.flags = flags
    }
}

function assemble_alu_ins(ins: string): number[] | null {
    let pattern = `(${Object.keys(ALU_INSTRUCTIONS).filter(v => v != 'not').join('|')}) (?:(a|b) (a|b)|(-?\\d{1,3}) (a|b)|(a|b) (-?\\d{1,3})) (a|b)|not (-?\\d{1,3}|a|b) (a|b)`
    let match = ins.toLowerCase().match(pattern)
    if (match == null) {
        return null
    }

    match = match.slice(1).filter(v => v != null)

    let ins_name = match[0]

    let instruction: number[] = [0]

    let prefix = 0
    let infix = ALU_INSTRUCTIONS[ins_name]
    let t1 = 0
    let t2 = 0
    let d = 0
    let immediate_value: number | null = null

    if (ins_name == 'not') {
        let op = match[1]
        if (op.match("-?\\d+")) {
            prefix = INS_ALU_I
            immediate_value = parseInt(op, 10)
        } else {
            prefix = INS_ALU_R
        }
        let dest = match[2]
        d = dest == 'a' ? 0 : 1
    } else {
        let op1 = match[1]
        let op2 = match[2]
        if (op1.match("-?\\d+") || op2.match("-?\\d+")) {
            prefix = INS_ALU_I
            if (op1.match("-?\\d+")) {
                immediate_value = parseInt(op1, 10)
                t1 = 0
            } else {
                immediate_value = parseInt(op2, 10)
                t1 = 1
            }
        } else {
            prefix = INS_ALU_R
        }
        if (op1 == 'b' && immediate_value == null) {
            t1 = 1
        } else if (op2 == 'b' && immediate_value == null) {
            t2 = 1
        } else if (immediate_value != null) {
            t2 = (op1 == 'a' || op2 == 'a') ? 0 : 1
        }
        let dest = match[3]
        d = dest == 'a' ? 0 : 1
    }

    if (immediate_value != null) {
        instruction[1] = immediate_value & ((1 << WORD_SIZE) - 1)
    }

    instruction[0] = (prefix << 6) | (infix << 3) | (t1 << 2) | (t2 << 1) | d
    return instruction
}

function assemble_jmp_ins(ins: string): number[] | null {
    let pattern = `(${Object.keys(JMP_INSTRUCTIONS).join('|')}) ([\\da-f]{2}|a|b)`
    let match = ins.toLowerCase().match(pattern)
    if (match == null) {
        return null
    }

    match = match.slice(1).filter(v => v != null)

    let ins_name = match[0]

    let instruction: number[] = [1]

    let prefix = INS_JMP
    let infix = JMP_INSTRUCTIONS[ins_name]
    let t1 = 0
    let t2 = 0
    let d = 0

    let op = match[1]
    if (op.match("[\\da-f]{2}")) {
        instruction[1] = parseInt(op, 16)
        t1 = 1
    } else if (op == 'b') {
        t2 = 1
    }

    instruction[0] = (prefix << 6) | (infix << 3) | (t1 << 2) | (t2 << 1) | d
    return instruction
}

function assemble_ram_ins(ins: string): number[] | null {
    let pattern = `(${Object.keys(RAM_INSTRUCTIONS).join('|')}) (-?[\\da-f]{1,3}|a|b) (a|b)`
    let match = ins.toLowerCase().match(pattern)
    if (match == null) {
        return null
    }

    match = match.slice(1).filter(v => v != null)

    let ins_name = match[0]

    let instruction: number[] = [0]

    let prefix = INS_RAM
    let infix = RAM_INSTRUCTIONS[ins_name]
    let t1 = 0
    let t2 = match[1] == 'b' ? 1:0
    let d = match[2] == 'b' ? 1 : 0

    let op = match[1]
    if (op.match("-?\\d{1,3}") && ins_name == "load") {
        instruction[1] = parseInt(op, 10) & ((1 << WORD_SIZE) - 1)
        t1 = 1
    } else if (op.match("[\\da-f]{1,2}") && ins_name == "save") {
        instruction[1] = parseInt(op, 16) & ((1 << WORD_SIZE) - 1)
    } else if (op != 'a' && op != 'b') {
        return null
    }

    instruction[0] = (prefix << 6) | (infix << 3) | (t1 << 2) | (t2 << 1) | d
    return instruction
}

function assemble_ins(ins: string): number[] | null {
    let instruction = assemble_alu_ins(ins)
    if (instruction != null) {
        return instruction
    }

    instruction = assemble_jmp_ins(ins)
    if (instruction != null) {
        return instruction
    }

    return assemble_ram_ins(ins)
}