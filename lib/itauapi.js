const debug = require('debug')('itau-api');
const request = require('request-promise-native');
const { URL } = require('url');
const { b64decode } = require('./utils.js');

const ErrorCodes = {

};

/**
 * Class that allows you to access to your Itau account
 */
module.exports = class ItauAPI {


  /**
   * Creates an ItauAPI object
   * @param {String} - Your ID
   * @param {String} - A base64 representation of your password
   */
  constructor(id, password) {
    debug('Created new api for %s', id);

    this._id = id;
    this._pass = b64decode(password);
    this.accounts = [];

    // Default request values
    this._baseUrl = 'https://www.itaulink.com.uy/trx/';
    this._rq = request.defaults({
      baseUrl: this._baseUrl,
      jar: request.jar(),
      resolveWithFullResponse: true,
      followRedirect: false,
      simple: false,
    });
  }


  /**
   * Logins with the provided credentials
   * @return {Promise}
   */
  login() {
    debug('Loging in');
    return this._doLogin()
      .then((res) => {
        const location = res.headers.location;
        const redirect = new URL(location || '');

        debug('Login redirected to %s', location);

        if (redirect.pathname === '/trx/') {
          return this._downloadAccounts();
        }

        const code = redirect.searchParams.get('message_code');
        const codeMessage = ErrorCodes[code] || 'Unknown error';

        debug('Login failied! %d: %s', code, codeMessage);

        throw new Error(codeMessage);
      });
  }


  /**
   * Returns the transactions on the given month as an array of objects with
   * the following keys:
   *   - type
   *   - description
   *   - extraDescription
   *   - amount
   *   - endBalance
   *   - date
   */
  getMonth(hash, month, year) {
    debug('Requesting movements for %d/%d', month, year);

    let movementsPromise;
    if (month === (new Date()).getMonth() + 1) {
      movementsPromise = this._rq.post(
        `/cuentas/1/${hash}/mesActual`,
      ).then((res) => {
        const rawData = JSON.parse(res.body);
        return rawData.itaulink_msg.data.movimientosMesActual.movimientos;
      });
    } else {
      movementsPromise = this._rq.post(
        `/cuentas/1/${hash}/${month}/${year}/consultaHistorica`,
      ).then((res) => {
        const rawData = JSON.parse(res.body);
        return rawData.itaulink_msg.data.mapaHistoricos.movimientosHistoricos;
      });
    }

    const movementTypes = {
      D: 'expense',
      C: 'income',
    };

    return movementsPromise.then(movements => movements.map(movement => ({
      type: movementTypes[movement.tipo],
      description: movement.descripcion,
      extraDescription: movement.descripcionAdicional,
      amount: movement.importe,
      endBalance: movement.tipo === 'D' ? movement.saldo * -1 : movement.saldo,
      date: new Date(movement.fecha.millis),
    })));
  }


  /**
   * Sends your login credentials.
   * Needs to GET /trx afterwards to finish the login
   * @return {Promise}
   */
  _doLogin() {
    debug('Sending credentials to /doLogin');
    return this._rq({
      url: '/doLogin',
      method: 'POST',
      form: {
        tipo_documento: 1,
        tipo_usuario: 'R',
        nro_documento: this._id,
        pass: this._pass,
        // id: 'login',
        // segmento: 'panelPersona',
        // password: this._pass,
        // empresa_aux: '',
        // pwd_empresa: '',
        // usuario_aux: '',
        // pwd_usuario: '',
        // empresa: '',
        // usuario: '',
      },
    });
  }


  /**
   * Downloads trx and parses the accounts
   */
  _downloadAccounts() {
    debug('Downloading trx');
    return this._rq.get('/').then((res) => {
      debug('Parsing trx');
      const lines = res.body.split('\n');
      const matchedLine = lines.find(
        line => line.includes('var mensajeUsuario = JSON.parse',
      ));
      const JSONMatcher = /JSON\.parse\((['"])(.*)\1\)/;
      const userData = JSON.parse(JSONMatcher.exec(matchedLine)[2]);
      debug('Parsed');

      debug('Parsing JSON');
      this.accounts = [
        ...userData.cuentas.caja_de_ahorro,
        ...userData.cuentas.cuenta_corriente,
        ...userData.cuentas.cuenta_recaudadora,
        ...userData.cuentas.cuenta_de_ahorro_junior,
      ].map(account => ({
        type: account.tipoCuenta,
        id: account.idCuenta,
        user: account.nombreTitular,
        currency: account.moneda,
        balance: account.saldo,
        hash: account.hash,
        customerHash: account.hashCustomer,
        customer: account.customer,

      }));
      debug('Parsed');
    });
  }


};
